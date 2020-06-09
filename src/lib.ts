import { addPath, endGroup, error, getInput, info, setFailed, startGroup, warning } from '@actions/core'
import { exec } from '@actions/exec'
import { create as glob } from '@actions/glob'
import FormData from 'form-data'
import { createReadStream, promises as fs } from 'fs'
import got, { Response } from 'got'
import os from 'os'
import path from 'path'
import { from } from 'rxjs'
import { filter, map, mergeAll, mergeMap, tap, toArray } from 'rxjs/operators'
import { Writable } from 'stream'
import { DOMParser } from 'xmldom'

export interface ProjInfo {
  csprojPath: string
  csprojDoc: XMLDocument
  packageId: string
  packable: boolean
  version: string
  publishable: boolean
}

export const initDotnet = (): Promise<number> => {
  const nullStream = new Writable({
    write() {
      void 0
    },
  })

  return exec('dotnet help', [], { outStream: nullStream, errStream: nullStream })
}

export const findPackables = async (): Promise<ProjInfo[]> =>
  from(await getProjPaths())
    .pipe(
      mergeMap(projInfoFromPath),
      tap((p) => info(`${p.packageId}: packable=${p.packable} version=${p.version}`)),
      filter((p) => p.packable && !!p.version),
      toArray(),
    )
    .toPromise()

export const getProjPaths = (patterns = '**/*.csproj'): Promise<string[]> => glob(patterns).then((x) => x.glob())

export const projInfoFromPath = (csprojPath: string): Promise<ProjInfo> =>
  fs.readFile(csprojPath, 'utf-8').then(projInfoFromXml(csprojPath))

export const projInfoFromXml = (csprojPath: string) => (xml: string): ProjInfo => {
  const doc = new DOMParser().parseFromString(xml)
  return {
    csprojPath,
    csprojDoc: doc,
    packageId: getProp('PackageId', doc) || getProp('AssemblyName', doc) || path.basename(csprojPath, '.csproj'),
    packable: getProp('IsPackable', doc)?.toLowerCase() === 'true',
    version: getProp('Version', doc) || '',
    publishable: false,
  }
}

export const getProp = (prop: string, doc: Document): string | undefined =>
  doc.getElementsByTagName(prop)[0]?.textContent?.trim()

export const findPublishables = (projs: ProjInfo[], owner: string, token: string): Promise<ProjInfo[]> =>
  from(projs)
    .pipe(
      mergeMap((projInfo) =>
        queryPublishable(projInfo.packageId, projInfo.version, owner, token).then(
          (publishable): ProjInfo => ({
            ...projInfo,
            publishable,
          }),
        ),
      ),
      tap((p) => {
        if (p.publishable) {
          info(`${p.packageId}: version ${p.version} not found, publishing`)
        } else {
          info(`${p.packageId}: version ${p.version} found, skipping`)
        }
      }),
      filter((p) => p.publishable),
      toArray(),
    )
    .toPromise()

export const queryPublishable = (packageId: string, version: string, owner: string, token: string): Promise<boolean> =>
  from(
    got(`https://nuget.pkg.github.com/${owner}/${packageId}/${version}.json`, {
      throwHttpErrors: false,
      password: token,
    }),
  )
    .pipe(
      map((r) => {
        if (![200, 404].includes(r.statusCode)) {
          throw new Error(`Failed fetching versions for ${packageId}: ${r.statusCode} ${r.statusMessage}`)
        }
        return r.statusCode === 404
      }),
    )
    .toPromise()

export const createSln = (projs: ProjInfo[]): Promise<number> =>
  exec('dotnet new sln -n _ci_nuget').then(() =>
    exec(
      'dotnet sln _ci_nuget.sln add',
      projs.map((p) => p.csprojPath),
    ),
  )

export const pack = (repoUrl: string, outpath = path.resolve('dist')): Promise<number> =>
  os.type() === 'Windows_NT'
    ? findMSBuild()
        .then((msbuildPath) => addPath(path.dirname(msbuildPath)))
        .then(() =>
          exec('msbuild _ci_nuget.sln', [
            '-t:Pack',
            '-r',
            '-m',
            '-p:RestorePackagesConfig=true',
            '-p:Configuration=Release',
            `-p:PackageOutputPath=${outpath}`,
            `-p:RepositoryUrl=${repoUrl}`,
          ]),
        )
    : exec(`dotnet pack _ci_nuget.sln -c release -o ${outpath} -p:RepositoryUrl=${repoUrl}`)

export const findMSBuild = (): Promise<string> =>
  new Promise((resolve) =>
    exec('vswhere -latest -requires Microsoft.Component.MSBuild -find MSBuild\\**\\Bin\\MSBuild.exe', [], {
      listeners: {
        stdout: (data: Buffer): void => {
          resolve(data.toString())
        },
      },
    }),
  )

export const pushAll = (owner: string, token: string, dirpath = 'dist'): Promise<unknown> =>
  from(fs.readdir(dirpath, { encoding: 'utf-8' }))
    .pipe(
      mergeAll(),
      tap((filename) => info(`pushing ${filename}...`)),
      mergeMap((filename) =>
        pushPackage(owner, token, path.resolve(dirpath, filename)).then((res) => ({
          filename,
          res,
          success: res.statusCode.toString()[0] === '2',
        })),
      ),
      tap(({ filename, res, success }) => {
        ;(success ? info : error)(`${filename}: [${res.statusCode}] ${res.body.trim()}`)
      }),
      toArray(),
      tap((a) => {
        if (a.some(({ success }) => !success)) {
          throw new Error('failed pusing some packages')
        }
      }),
    )
    .toPromise()

export const pushPackage = (owner: string, token: string, filepath: string): Promise<Response<string>> => {
  const form = new FormData()
  form.append('package', createReadStream(filepath))

  return got.put(`https://nuget.pkg.github.com/${owner}`, {
    password: token,
    body: form,
    throwHttpErrors: false,
  })
}

export const run = async (): Promise<void> => {
  try {
    const owner = process.env.GITHUB_REPOSITORY_OWNER as string
    const repo = process.env.GITHUB_REPOSITORY as string
    const repoUrl = `https://github.com/${repo}`
    const token = getInput('token')

    await initDotnet()

    startGroup('Scan projects for packables')
    const packables = await findPackables()
    endGroup()

    if (!packables.length) {
      warning('No packable projects were found')
      return
    }

    startGroup('Query nuget registry for unpublished projects')
    const publishables = await findPublishables(packables, owner, token)
    endGroup()

    if (!publishables.length) {
      info('No unpublished projects were found')
      return
    }

    startGroup('Create sln')
    await createSln(publishables)
    endGroup()

    startGroup('Pack packages')
    await pack(repoUrl)
    endGroup()

    startGroup('Push packages')
    await pushAll(owner, token)
    endGroup()
  } catch (e) {
    setFailed(e)
  }
}
