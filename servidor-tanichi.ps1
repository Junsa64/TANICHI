# =============================================================================
#  EL TANICHI · Servidor local
#  Lo arranca TANICHI.bat. Sirve la app en http://localhost:8123 sólo para
#  este equipo. Usa PowerShell, que ya viene en Windows: no hay que instalar
#  nada en la computadora de la tienda.
#
#  Hace falta porque el navegador no deja instalar una aplicación ni guardarla
#  para trabajar sin internet cuando la página se abre como archivo suelto.
# =============================================================================

$ErrorActionPreference = 'Stop'
$RAIZ   = Split-Path -Parent $MyInvocation.MyCommand.Path
$PUERTO = 8123
$REPO   = 'Junsa64/TANICHI'

# Sólo estos archivos se tocan al actualizar: el código del programa. Nunca
# el catálogo ni los respaldos del negocio —ésos ni siquiera viven en el
# repositorio— y nunca las ventas ni el inventario, que están en el
# navegador, no en esta carpeta.
$ARCHIVOS_APP = @(
  'index.html', 'style.css', 'manifest.json', 'sw.js',
  'TANICHI.bat', 'servidor-tanichi.ps1', 'cerrar-servidor.ps1',
  'icon.png', 'icono-192.jpg', 'icono-512.jpg', 'icono-mask.jpg'
)

$TIPOS = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/manifest+json; charset=utf-8'
  '.csv'  = 'text/csv; charset=utf-8'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.svg'  = 'image/svg+xml'
  '.webp' = 'image/webp'
  '.ico'  = 'image/x-icon'
  '.txt'  = 'text/plain; charset=utf-8'
}

# ---------------------------------------------------- Mercado Pago (Point) --
# El token vive SÓLO en esta computadora, en este archivo, que nunca se sube
# al repositorio (ver .gitignore). El navegador nunca lo ve: le pide a este
# servidor, y este servidor es quien de verdad llama a Mercado Pago.
$MP_CRED_ARCHIVO = Join-Path $RAIZ 'mp-credenciales.json'

function Leer-CredencialesMP {
  if (Test-Path -LiteralPath $MP_CRED_ARCHIVO) {
    try { return Get-Content -LiteralPath $MP_CRED_ARCHIVO -Raw | ConvertFrom-Json } catch { return $null }
  }
  return $null
}

function Responder-Json($res, $objeto, $codigo = 200) {
  $json = $objeto | ConvertTo-Json -Depth 12 -Compress
  $b = [System.Text.Encoding]::UTF8.GetBytes($json)
  $res.StatusCode = $codigo
  $res.ContentType = 'application/json; charset=utf-8'
  $res.Headers.Add('Cache-Control', 'no-store')
  $res.ContentLength64 = $b.Length
  $res.OutputStream.Write($b, 0, $b.Length)
  $res.Close()
}

function Leer-CuerpoJson($req) {
  $lector = New-Object System.IO.StreamReader($req.InputStream, $req.ContentEncoding)
  $texto = $lector.ReadToEnd()
  if ([string]::IsNullOrWhiteSpace($texto)) { return $null }
  return $texto | ConvertFrom-Json
}

# Llama a la API real de Mercado Pago. Si algo sale mal, intenta rescatar el
# mensaje de error que manda Mercado Pago (no sólo "error 400").
function Invocar-MP {
  param([string]$Metodo, [string]$Ruta, [string]$Token, $Cuerpo = $null, [string]$IdempotencyKey = $null)
  $headers = @{ 'Authorization' = "Bearer $Token" }
  if ($IdempotencyKey) { $headers['X-Idempotency-Key'] = $IdempotencyKey }
  $uri = "https://api.mercadopago.com$Ruta"
  try {
    if ($null -ne $Cuerpo) {
      $json = $Cuerpo | ConvertTo-Json -Depth 12
      return Invoke-RestMethod -Method $Metodo -Uri $uri -Headers $headers -ContentType 'application/json' -Body $json -TimeoutSec 20
    } else {
      return Invoke-RestMethod -Method $Metodo -Uri $uri -Headers $headers -ContentType 'application/json' -TimeoutSec 20
    }
  } catch {
    $cuerpoError = $null
    if ($_.Exception.Response) {
      try {
        $stream = $_.Exception.Response.GetResponseStream()
        $lector = New-Object System.IO.StreamReader($stream)
        $cuerpoError = $lector.ReadToEnd()
      } catch { }
    }
    if ($cuerpoError) { throw $cuerpoError } else { throw $_.Exception.Message }
  }
}

$escucha = New-Object System.Net.HttpListener
$escucha.Prefixes.Add("http://localhost:$PUERTO/")

try { $escucha.Start() }
catch {
  # Ya hay uno corriendo: el .bat sólo tiene que abrir la ventana
  Write-Output 'YA_ABIERTA'
  exit 3
}

Write-Output "LISTO $PUERTO"

while ($escucha.IsListening) {
  try {
    $ctx = $escucha.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response

    $rel = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath).TrimStart('/')
    if ([string]::IsNullOrWhiteSpace($rel)) { $rel = 'index.html' }

    # Qué carpeta está sirviendo. La app lo muestra en Ajustes: si abres una
    # carpeta y ves otra ruta, es que quedó corriendo un servidor anterior.
    if ($rel -eq '__origen') {
      $b = [System.Text.Encoding]::UTF8.GetBytes($RAIZ)
      $res.ContentType = 'text/plain; charset=utf-8'
      $res.Headers.Add('Cache-Control', 'no-store')
      $res.ContentLength64 = $b.Length
      $res.OutputStream.Write($b, 0, $b.Length)
      $res.Close()
      continue
    }

    # Actualizar: baja la última versión del repositorio y reemplaza sólo
    # los archivos del programa (ver $ARCHIVOS_APP arriba). La app ya
    # confirmó con el dueño antes de llamar aquí.
    if ($req.HttpMethod -eq 'POST' -and $rel -eq '__actualizar') {
      $cuerpo = $null; $codigo = 200
      try {
        $zip = Join-Path $env:TEMP ('tanichi-act-' + [guid]::NewGuid() + '.zip')
        $dir = Join-Path $env:TEMP ('tanichi-act-' + [guid]::NewGuid())
        Invoke-WebRequest -Uri "https://github.com/$REPO/archive/refs/heads/main.zip" `
          -OutFile $zip -UseBasicParsing -TimeoutSec 40
        Expand-Archive -Path $zip -DestinationPath $dir -Force

        # El zip de GitHub trae todo dentro de una única subcarpeta
        $nuevo = Get-ChildItem $dir -Directory | Select-Object -First 1
        if (-not $nuevo) { throw 'el zip descargado llegó vacío' }

        foreach ($f in $ARCHIVOS_APP) {
          $origen = Join-Path $nuevo.FullName $f
          if (Test-Path -LiteralPath $origen -PathType Leaf) {
            Copy-Item -LiteralPath $origen -Destination (Join-Path $RAIZ $f) -Force
          }
        }
        $jsOrigen = Join-Path $nuevo.FullName 'js'
        if (Test-Path -LiteralPath $jsOrigen) {
          Copy-Item -Path (Join-Path $jsOrigen '*') -Destination (Join-Path $RAIZ 'js') -Force -Recurse
        }

        Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
        $cuerpo = 'ok'
      } catch {
        $codigo = 500
        $cuerpo = 'error: ' + $_.Exception.Message
      }
      $b = [System.Text.Encoding]::UTF8.GetBytes($cuerpo)
      $res.StatusCode = $codigo
      $res.ContentType = 'text/plain; charset=utf-8'
      $res.Headers.Add('Cache-Control', 'no-store')
      $res.ContentLength64 = $b.Length
      $res.OutputStream.Write($b, 0, $b.Length)
      $res.Close()
      continue
    }

    # -------------------------------------------------- Mercado Pago (Point)
    if ($rel -eq '__mp/estado') {
      $cred = Leer-CredencialesMP
      $configurado = [bool]($cred -and $cred.accessToken)
      Responder-Json $res @{
        configurado = $configurado
        storeId = $(if ($cred) { [string]$cred.storeId } else { '' })
        posId   = $(if ($cred) { [string]$cred.posId }   else { '' })
      }
      continue
    }

    if ($req.HttpMethod -eq 'POST' -and $rel -eq '__mp/guardar') {
      try {
        $datos = Leer-CuerpoJson $req
        $obj = [ordered]@{
          accessToken = [string]$datos.accessToken
          storeId     = [string]$datos.storeId
          posId       = [string]$datos.posId
        }
        $obj | ConvertTo-Json | Set-Content -LiteralPath $MP_CRED_ARCHIVO -Encoding UTF8
        Responder-Json $res @{ ok = $true }
      } catch {
        Responder-Json $res @{ error = $_.Exception.Message } 500
      }
      continue
    }

    if ($rel -eq '__mp/terminales') {
      $cred = Leer-CredencialesMP
      if (-not ($cred -and $cred.accessToken)) { Responder-Json $res @{ error = 'Falta configurar el Access Token en Ajustes.' } 400; continue }
      try {
        $q = '?limit=50'
        if ($cred.storeId) { $q += "&store_id=$($cred.storeId)" }
        if ($cred.posId)   { $q += "&pos_id=$($cred.posId)" }
        Responder-Json $res (Invocar-MP -Metodo GET -Ruta "/point/integration-api/devices$q" -Token $cred.accessToken)
      } catch {
        Responder-Json $res @{ error = $_.Exception.Message } 502
      }
      continue
    }

    if ($req.HttpMethod -eq 'POST' -and $rel -eq '__mp/cobrar') {
      $cred = Leer-CredencialesMP
      if (-not ($cred -and $cred.accessToken)) { Responder-Json $res @{ error = 'Falta configurar el Access Token en Ajustes.' } 400; continue }
      try {
        $datos = Leer-CuerpoJson $req
        $monto = [decimal]$datos.monto
        $montoTxt = $monto.ToString('0.00', [System.Globalization.CultureInfo]::InvariantCulture)
        $cuerpo = @{
          type = 'point'
          external_reference = 'tanichi_' + [guid]::NewGuid().ToString('N').Substring(0, 16)
          expiration_time = 'PT10M'
          transactions = @{ payments = @(@{ amount = $montoTxt }) }
          config = @{ point = @{ terminal_id = [string]$datos.terminalId; print_on_terminal = 'no_ticket' } }
        }
        Responder-Json $res (Invocar-MP -Metodo POST -Ruta '/v1/orders' -Token $cred.accessToken -Cuerpo $cuerpo -IdempotencyKey ([guid]::NewGuid().ToString()))
      } catch {
        Responder-Json $res @{ error = $_.Exception.Message } 502
      }
      continue
    }

    if ($rel -eq '__mp/orden') {
      $cred = Leer-CredencialesMP
      if (-not ($cred -and $cred.accessToken)) { Responder-Json $res @{ error = 'Falta configurar el Access Token en Ajustes.' } 400; continue }
      $ordenId = $req.QueryString['id']
      if (-not $ordenId) { Responder-Json $res @{ error = 'Falta el id de la orden.' } 400; continue }
      try {
        Responder-Json $res (Invocar-MP -Metodo GET -Ruta "/v1/orders/$ordenId" -Token $cred.accessToken)
      } catch {
        Responder-Json $res @{ error = $_.Exception.Message } 502
      }
      continue
    }

    if ($req.HttpMethod -eq 'POST' -and $rel -eq '__mp/cancelar') {
      $cred = Leer-CredencialesMP
      if (-not ($cred -and $cred.accessToken)) { Responder-Json $res @{ error = 'Falta configurar el Access Token en Ajustes.' } 400; continue }
      $ordenId = $req.QueryString['id']
      try {
        Invocar-MP -Metodo POST -Ruta "/v1/orders/$ordenId/cancel" -Token $cred.accessToken | Out-Null
        Responder-Json $res @{ ok = $true }
      } catch {
        Responder-Json $res @{ error = $_.Exception.Message } 502
      }
      continue
    }

    if ($rel -eq '__mp/movimientos') {
      $cred = Leer-CredencialesMP
      if (-not ($cred -and $cred.accessToken)) { Responder-Json $res @{ error = 'Falta configurar el Access Token en Ajustes.' } 400; continue }
      try {
        $desde = $req.QueryString['desde']
        $hasta = $req.QueryString['hasta']
        $q = '?sort=date_created&criteria=desc&range=date_created&limit=200'
        if ($desde) { $q += '&begin_date=' + [Uri]::EscapeDataString($desde + 'T00:00:00.000-06:00') }
        if ($hasta) { $q += '&end_date='   + [Uri]::EscapeDataString($hasta + 'T23:59:59.999-06:00') }
        Responder-Json $res (Invocar-MP -Metodo GET -Ruta "/v1/payments/search$q" -Token $cred.accessToken)
      } catch {
        Responder-Json $res @{ error = $_.Exception.Message } 502
      }
      continue
    }

    $archivo = [System.IO.Path]::GetFullPath((Join-Path $RAIZ $rel))

    # Nadie sale de la carpeta de la app
    if (-not $archivo.StartsWith($RAIZ, [StringComparison]::OrdinalIgnoreCase)) {
      $res.StatusCode = 403
      $res.Close()
      continue
    }

    if (Test-Path -LiteralPath $archivo -PathType Leaf) {
      $datos = [System.IO.File]::ReadAllBytes($archivo)
      $ext   = [System.IO.Path]::GetExtension($archivo).ToLower()
      $res.ContentType = $(if ($TIPOS.ContainsKey($ext)) { $TIPOS[$ext] } else { 'application/octet-stream' })
      # Sin caché del navegador: manda el trabajador de servicio, que es
      # quien guarda la app. Así una versión nueva llega al reabrir.
      $res.Headers.Add('Cache-Control', 'no-cache')
      $res.Headers.Add('Service-Worker-Allowed', '/')
      $res.ContentLength64 = $datos.Length
      $res.OutputStream.Write($datos, 0, $datos.Length)
    } else {
      $res.StatusCode = 404
      $msg = [System.Text.Encoding]::UTF8.GetBytes("No existe: $rel")
      $res.ContentType = 'text/plain; charset=utf-8'
      $res.ContentLength64 = $msg.Length
      $res.OutputStream.Write($msg, 0, $msg.Length)
    }
    $res.Close()
  } catch {
    # Una petición cortada a media carga no debe tumbar la caja
    continue
  }
}
