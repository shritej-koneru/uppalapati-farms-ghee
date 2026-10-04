# Verifies a workbook opens in Excel with no repair prompt, and reports what is in it.
# Usage: powershell -File scripts/verify-xlsx.ps1 -Path <file.xlsx>

param([Parameter(Mandatory = $true)][string]$Path)

$excel = $null
$book = $null
try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.AskToUpdateLinks = $false

  # CorruptLoad = 0 (xlNormalLoad) is the whole point: Excel only raises here when
  # the file is damaged, rather than silently repairing it into a usable workbook.
  $book = $excel.Workbooks.Open($Path, 0, $true, [Type]::Missing, [Type]::Missing, [Type]::Missing, $true, [Type]::Missing, [Type]::Missing, [Type]::Missing, [Type]::Missing, [Type]::Missing, [Type]::Missing, 0)

  $sheet = $book.Worksheets.Item(1)
  $used = $sheet.UsedRange

  Write-Output ("opened cleanly     : yes")
  Write-Output ("used range         : {0} ({1} rows x {2} columns)" -f $used.Address(0, 0), $used.Rows.Count, $used.Columns.Count)

  $columns = $used.Columns.Count
  $headers = @()
  for ($c = 1; $c -le $columns; $c++) { $headers += [string]$sheet.Cells.Item(1, $c).Value2 }
  Write-Output ("header row         : {0}" -f ($headers -join ' | '))
  Write-Output ("header is bold     : {0}" -f $sheet.Cells.Item(1, 1).Font.Bold)

  for ($r = 2; $r -le $used.Rows.Count; $r++) {
    Write-Output ("row {0}             : {1}" -f $r, (($used.Rows.Item($r).Value2 | ForEach-Object { [string]$_ }) -join ' | '))
  }

  # The Total column must be a real number, not text, or nothing can sum it.
  $totalCol = [Array]::IndexOf($headers, 'Total') + 1
  if ($totalCol -gt 0) {
    $value = $sheet.Cells.Item(2, $totalCol).Value2
    Write-Output ("Total column       : index {0}, type {1}, value {2}" -f $totalCol, $(if ($null -eq $value) { 'empty' } else { $value.GetType().Name }), $value)
  }

  Write-Output ("status cell        : A2 = '{0}'" -f $sheet.Cells.Item(2, 1).Value2)
}
catch {
  Write-Output ("opened cleanly     : NO - {0}" -f $_.Exception.Message)
  exit 1
}
finally {
  if ($book) { $book.Close($false) }
  if ($excel) { $excel.Quit() }
  if ($book) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($book) }
  if ($excel) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) }
  [GC]::Collect()
}