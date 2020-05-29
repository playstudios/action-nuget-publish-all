import { projInfoFromXml } from './lib'

const csprojPath = '/fake/path/Foo.Bar.csproj'

test('projInfoFromPath: basic', () => {
  expect(
    projInfoFromXml(csprojPath)(`
    <Project Sdk="Microsoft.NET.Sdk">
      <PropertyGroup>
        <TargetFramework>netstandard2.0</TargetFramework>
        <IsPackable>true</IsPackable>
        <Version>1.2.3.4</Version>
      </PropertyGroup>
    </Project>
    `),
  ).toMatchObject({
    csprojPath,
    packageId: 'Foo.Bar',
    packable: true,
    version: '1.2.3.4',
  })
})

test('projInfoFromPath: with AssemblyName', () => {
  expect(
    projInfoFromXml(csprojPath)(`
    <Project Sdk="Microsoft.NET.Sdk">
      <PropertyGroup>
        <TargetFramework>netstandard2.0</TargetFramework>
        <AssemblyName>Foo.Baz</AssemblyName>
        <IsPackable>true</IsPackable>
        <Version>1.2.3.4</Version>
      </PropertyGroup>
    </Project>
    `),
  ).toMatchObject({
    csprojPath,
    packageId: 'Foo.Baz',
    packable: true,
    version: '1.2.3.4',
  })
})

test('projInfoFromPath: with PackageId', () => {
  expect(
    projInfoFromXml(csprojPath)(`
    <Project Sdk="Microsoft.NET.Sdk">
      <PropertyGroup>
        <TargetFramework>netstandard2.0</TargetFramework>
        <AssemblyName>Foo.Baz</AssemblyName>
        <PackageId>Foo.Qux</PackageId>
        <IsPackable>true</IsPackable>
        <Version>1.2.3.4</Version>
      </PropertyGroup>
    </Project>
    `),
  ).toMatchObject({
    csprojPath,
    packageId: 'Foo.Qux',
    packable: true,
    version: '1.2.3.4',
  })
})

test('projInfoFromPath: without IsPackable', () => {
  expect(
    projInfoFromXml(csprojPath)(`
    <Project Sdk="Microsoft.NET.Sdk">
      <PropertyGroup>
        <TargetFramework>netstandard2.0</TargetFramework>
        <Version>1.2.3.4</Version>
      </PropertyGroup>
    </Project>
    `),
  ).toMatchObject({
    csprojPath,
    packageId: 'Foo.Bar',
    packable: false,
    version: '1.2.3.4',
  })
})

test('projInfoFromPath: without version', () => {
  expect(
    projInfoFromXml(csprojPath)(`
    <Project Sdk="Microsoft.NET.Sdk">
      <PropertyGroup>
        <TargetFramework>netstandard2.0</TargetFramework>
        <IsPackable>true</IsPackable>
      </PropertyGroup>
    </Project>
    `),
  ).toMatchObject({
    csprojPath,
    packageId: 'Foo.Bar',
    packable: true,
    version: undefined,
  })
})

test('projInfoFromPath: capitalized IsPackable', () => {
  expect(
    projInfoFromXml(csprojPath)(`
    <Project Sdk="Microsoft.NET.Sdk">
      <PropertyGroup>
        <TargetFramework>netstandard2.0</TargetFramework>
        <IsPackable>True</IsPackable>
        <Version>1.2.3.4</Version>
      </PropertyGroup>
    </Project>
    `),
  ).toMatchObject({
    csprojPath,
    packageId: 'Foo.Bar',
    packable: true,
    version: '1.2.3.4',
  })
})
