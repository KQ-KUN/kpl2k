param(
  [string]$OutputDirectory = "tmp/staff-avatar-candidates",
  [int]$CandidateCount = 5
)

$ErrorActionPreference = "Stop"
$people = @(
  @{ Name = "久哲"; Slug = "jiuzhe"; Query = "KPL 教练 久哲 个人资料 头像" },
  @{ Name = "Gemini"; Slug = "gemini"; Query = "KPL 教练 Gemini 郭家毅 头像" },
  @{ Name = "SK"; Slug = "sk"; Query = "KPL 教练 SK 头像" },
  @{ Name = "张角"; Slug = "zhangjiao"; Query = "KPL 教练 张角 头像" },
  @{ Name = "林"; Slug = "lin"; Query = "KPL 教练 老林 头像" },
  @{ Name = "花楼"; Slug = "hualou"; Query = "KPL 教练 花楼 头像" },
  @{ Name = "LoveCD"; Slug = "lovecd"; Query = "KPL 教练 LoveCD 头像" },
  @{ Name = "770"; Slug = "770"; Query = "KPL 770 教练 头像" },
  @{ Name = "李九"; Slug = "lijiu"; Query = "KPL 解说 李九 个人资料 头像" },
  @{ Name = "瓶子"; Slug = "pingzi"; Query = "KPL 解说 瓶子 个人资料 头像" },
  @{ Name = "英凯"; Slug = "yingkai"; Query = "KPL 解说 英凯 个人资料 头像" },
  @{ Name = "潇洒"; Slug = "xiaosa"; Query = "KPL 解说 潇洒 个人资料 头像" },
  @{ Name = "狂人"; Slug = "kuangren"; Query = "KPL 解说 狂人 个人资料 头像" },
  @{ Name = "黄超"; Slug = "huangchao"; Query = "KPL 解说 黄超 个人资料 头像" },
  @{ Name = "居居"; Slug = "juju"; Query = "KPL 解说 居居 个人资料 头像" },
  @{ Name = "天云"; Slug = "tianyun"; Query = "KPL 解说 天云 个人资料 头像" },
  @{ Name = "灵儿"; Slug = "linger"; Query = "KPL 解说 灵儿 个人资料 头像" },
  @{ Name = "琪琪"; Slug = "qiqi"; Query = "KPL 解说 琪琪 个人资料 头像" }
)

$outputRoot = $OutputDirectory
New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
$allMetadata = @()

foreach ($person in $people) {
  $personDirectory = Join-Path $outputRoot $person.Slug
  New-Item -ItemType Directory -Force -Path $personDirectory | Out-Null
  $encodedQuery = [uri]::EscapeDataString($person.Query)
  $searchHtmlPath = Join-Path $personDirectory "search.html"
  Invoke-WebRequest -UseBasicParsing -Uri "https://duckduckgo.com/?q=$encodedQuery&iax=images&ia=images" -Headers @{ "User-Agent" = "Mozilla/5.0" } -OutFile $searchHtmlPath
  $searchHtml = Get-Content -Raw -Encoding UTF8 $searchHtmlPath
  $vqd = [regex]::Match($searchHtml, 'vqd="([^"]+)"').Groups[1].Value
  if (-not $vqd) {
    Write-Warning "未取得 $($person.Name) 的搜索令牌"
    continue
  }

  $jsonPath = Join-Path $personDirectory "results.json"
  $apiUrl = "https://duckduckgo.com/i.js?l=cn-zh&o=json&q=$encodedQuery&vqd=$vqd&f=,,,&p=1"
  Invoke-WebRequest -UseBasicParsing -Uri $apiUrl -Headers @{ "User-Agent" = "Mozilla/5.0"; Referer = "https://duckduckgo.com/" } -OutFile $jsonPath
  $response = Get-Content -Raw -Encoding UTF8 $jsonPath | ConvertFrom-Json
  $selected = @($response.results | Where-Object { $_.thumbnail -and $_.image -and $_.url } | Select-Object -First $CandidateCount)

  for ($index = 0; $index -lt $selected.Count; $index++) {
    $candidate = $selected[$index]
    $target = Join-Path $personDirectory ("candidate-{0}.jpg" -f ($index + 1))
    Invoke-WebRequest -UseBasicParsing -Uri $candidate.thumbnail -Headers @{ "User-Agent" = "Mozilla/5.0" } -OutFile $target
    $allMetadata += [pscustomobject]@{
      name = $person.Name
      slug = $person.Slug
      rank = $index + 1
      title = $candidate.title
      sourcePage = $candidate.url
      originalImage = $candidate.image
      thumbnail = $candidate.thumbnail
      localFile = $target.Substring($outputRoot.Length + 1).Replace("\", "/")
    }
  }
  Start-Sleep -Milliseconds 350
}

$metadataPath = Join-Path $outputRoot "metadata.json"
$allMetadata | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 -LiteralPath $metadataPath
Write-Output "候选图片：$($allMetadata.Count)"
Write-Output "元数据：$metadataPath"
