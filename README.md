# action-nuget-publish-all

Build and publish NuGet packages to GPR for all projects that:

- explicitly sets `<IsPackable>true</IsPackable>`
- explicitly sets a version with `<Version>`
- the version does not exist on GPR

## Package Id

The nuget package id used to search on GPR is extracted in the following order:

- `<PackageId>`
- `<AssemblyName>`
- the csproj file name
