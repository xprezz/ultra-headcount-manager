param(
    [string]$Version = "1.1.0",
    [string]$ClientId = $env:UHM_ENTRA_CLIENT_ID,
    [string]$TenantId = "72f988bf-86f1-41af-91ab-2d7cd011db47",
    [string[]]$Runtimes = @("win-x64", "win-arm64"),
    [string]$DotNet = "dotnet",
    [string]$InnoCompiler = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path $PSScriptRoot -Parent
$artifacts = Join-Path $projectRoot "artifacts"
$project = Join-Path $PSScriptRoot "UltraHeadcountManager.Desktop.csproj"
$installer = Join-Path $PSScriptRoot "installer.iss"

Push-Location $projectRoot
try {
    npm run build:desktop:web
    if ($LASTEXITCODE -ne 0) { throw "The web application build failed." }

    & $DotNet restore $project
    if ($LASTEXITCODE -ne 0) { throw "The desktop restore failed." }

    foreach ($runtime in $Runtimes) {
        $publish = Join-Path $artifacts "publish\$runtime"
        if (Test-Path $publish) { Remove-Item $publish -Recurse -Force }

        & $DotNet publish $project `
            --configuration Release `
            --runtime $runtime `
            --self-contained true `
            --no-restore `
            -p:Version=$Version `
            -p:PublishSingleFile=true `
            -p:IncludeNativeLibrariesForSelfExtract=true `
            -p:DebugType=None `
            -p:DebugSymbols=false `
            --output $publish
        if ($LASTEXITCODE -ne 0) { throw "Publishing $runtime failed." }

        Get-ChildItem $publish -Filter *.xml -File | Remove-Item -Force
        @{
            entra = @{
                clientId = $ClientId
                tenantId = $TenantId
            }
        } | ConvertTo-Json -Depth 3 |
            Set-Content -Path (Join-Path $publish "desktopsettings.json") -Encoding utf8NoBOM
    }

    if (-not $InnoCompiler) {
        $InnoCompiler = Get-ChildItem "$env:LOCALAPPDATA\Programs" -Filter ISCC.exe -Recurse -ErrorAction SilentlyContinue |
            Select-Object -First 1 -ExpandProperty FullName
    }
    if (-not $InnoCompiler -or -not (Test-Path $InnoCompiler)) {
        throw "Inno Setup 6 was not found. Install JRSoftware.InnoSetup with winget."
    }

    $dependencyDirectory = Join-Path $PSScriptRoot "Dependencies"
    $webViewBootstrapper = Join-Path $dependencyDirectory "MicrosoftEdgeWebview2Setup.exe"
    if (-not (Test-Path $webViewBootstrapper)) {
        New-Item -ItemType Directory -Force -Path $dependencyDirectory | Out-Null
        Invoke-WebRequest `
            -Uri "https://go.microsoft.com/fwlink/p/?LinkId=2124703" `
            -OutFile $webViewBootstrapper
    }

    $installerOutput = Join-Path $artifacts "installers"
    New-Item -ItemType Directory -Force -Path $installerOutput | Out-Null
    foreach ($runtime in $Runtimes) {
        $publish = Join-Path $artifacts "publish\$runtime"
        & $InnoCompiler `
            "/DMyAppVersion=$Version" `
            "/DMyAppArch=$runtime" `
            "/DSourceDir=$publish" `
            "/O$installerOutput" `
            $installer
        if ($LASTEXITCODE -ne 0) { throw "Building the $runtime installer failed." }
    }
}
finally {
    Pop-Location
}
