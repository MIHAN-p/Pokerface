# Pokerface 纯终端客户端 (PowerShell)
# 用法: .\poker-telnet.ps1
# 替代 telnet 命令，支持 GBK 中文显示和输入

param(
    [string]$Host = "122.51.83.182",
    [int]$Port = 80
)

try {
    $client = New-Object System.Net.Sockets.TcpClient($Host, $Port)
    $stream = $client.GetStream()

    # 读取数据并显示的后台任务
    $script:running = $true
    $readerJob = {
        param($s, $enc)
        $buffer = New-Object byte[] 4096
        try {
            while ($true) {
                if ($s.DataAvailable) {
                    $read = $s.Read($buffer, 0, $buffer.Length)
                    if ($read -gt 0) {
                        $text = $enc.GetString($buffer, 0, $read)
                        Write-Host -NoNewline $text
                    }
                }
                Start-Sleep -Milliseconds 50
            }
        } catch {}
    }

    $enc = [System.Text.Encoding]::GetEncoding(936)
    $job = [System.Management.Automation.Job]::Start($readerJob, $stream, $enc)

    Write-Host "=== Pokerface 纯终端客户端 ==="
    Write-Host "输入 q 退出"
    Write-Host ""

    # 主循环：读取用户输入并发送
    while ($client.Connected) {
        $input = Read-Host
        if ($input -eq 'q') { break }
        $data = $enc.GetBytes("$input`r`n")
        $stream.Write($data, 0, $data.Length)
    }

    $script:running = $false
    $stream.Close()
    $client.Close()
    Write-Host "已断开连接。"
} catch {
    Write-Host "错误: $_"
}
