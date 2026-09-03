# =============================================================================
#  EL TANICHI · Cierra servidores colgados
#  Lo llama TANICHI.bat antes de arrancar.
#
#  Por qué existe: el servidor queda escuchando en segundo plano aunque cierres
#  la app. Si luego abres una carpeta NUEVA, el puerto ya está ocupado por el
#  viejo y el navegador te seguiría mostrando la versión anterior. Esto los
#  cierra para que siempre mande la carpeta desde la que arrancaste.
# =============================================================================

$ErrorActionPreference = 'SilentlyContinue'

# El patrón tiene que ser ESTRICTO: sólo procesos lanzados como
#   powershell ... -File <ruta>\servidor-tanichi.ps1
# Buscar el nombre suelto dentro de la línea de comandos también encontraría
# cualquier otro script que lo mencione —incluido este— y se mataría solo.
$patron = '-File\s+"?[^"]*servidor-tanichi\.ps1"?\s*$'

Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match $patron } |
  ForEach-Object {
    Write-Output "cerrando servidor PID $($_.ProcessId)"
    Stop-Process -Id $_.ProcessId -Force
  }

# Esperar a que el puerto quede realmente libre (hasta 8 segundos)
for ($i = 0; $i -lt 16; $i++) {
  try {
    $c = New-Object Net.Sockets.TcpClient('127.0.0.1', 8123)
    $c.Close()
    Start-Sleep -Milliseconds 500      # sigue ocupado
  } catch {
    break                              # libre
  }
}
