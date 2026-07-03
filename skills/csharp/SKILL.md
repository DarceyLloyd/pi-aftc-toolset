---
name: csharp
description: C# / .NET with dotnet CLI, ASP.NET, Entity Framework, and best practices. Use when writing or editing .cs files, .csproj, working with dotnet CLI, ASP.NET, Blazor, or Entity Framework.
---

# C#

## .NET CLI
- `dotnet new console` - create console app
- `dotnet new webapi` - create Web API
- `dotnet new sln` - create solution
- `dotnet sln add <project>` - add project to solution
- `dotnet build` - build project/solution
- `dotnet run` - build and run
- `dotnet test` - run tests
- `dotnet publish -c Release` - publish for deployment
- Use `--framework net10.0` for .NET 10

## Code Conventions
- Use `var` when type obvious. Explicit types for public APIs.
- `async/await` - never `.Result` or `.Wait()`
- `nameof()` not hardcoded strings
- Nullable reference types: `<Nullable>enable</Nullable>`
- Expression-bodied members for simple properties
- PascalCase public, camelCase private, `_prefix` fields
- `IEnumerable<T>` over `List<T>` for returns (iteration only)
- `using` statements for `IDisposable`

## Project Structure
```
MyApp/
├── MyApp.sln
├── src/
│   └── MyApp/
│       ├── MyApp.csproj
│       └── Program.cs
└── tests/
    └── MyApp.Tests/
```

## Verification
- Build: `dotnet build --nologo`
- Run: `dotnet run --project <path>`
- Test: `dotnet test`
- Check .NET version: `dotnet --version`
