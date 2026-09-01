param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [Parameter(Mandatory = $true)][string]$OutputPath
)

Add-Type -AssemblyName System.Drawing

if (-not ("CheckerBackground" -as [type])) {
  Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class CheckerBackground
{
    private static bool IsBackground(byte blue, byte green, byte red)
    {
        int max = Math.Max(red, Math.Max(green, blue));
        int min = Math.Min(red, Math.Min(green, blue));
        return min >= 224 && max - min <= 24;
    }

    public static void Remove(string inputPath, string outputPath)
    {
        using (var source = new Bitmap(inputPath))
        using (var bitmap = new Bitmap(source.Width, source.Height, PixelFormat.Format32bppArgb))
        {
            using (var graphics = Graphics.FromImage(bitmap))
            {
                graphics.DrawImageUnscaled(source, 0, 0);
            }

            var rectangle = new Rectangle(0, 0, bitmap.Width, bitmap.Height);
            var bits = bitmap.LockBits(rectangle, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
            int stride = bits.Stride;
            int byteCount = Math.Abs(stride) * bitmap.Height;
            var pixels = new byte[byteCount];
            Marshal.Copy(bits.Scan0, pixels, 0, byteCount);

            int width = bitmap.Width;
            int height = bitmap.Height;
            var visited = new byte[width * height];
            var queue = new int[width * height];
            int head = 0;
            int tail = 0;

            Action<int, int> enqueue = (x, y) =>
            {
                int index = y * width + x;
                if (visited[index] != 0) return;
                int offset = y * stride + x * 4;
                if (!IsBackground(pixels[offset], pixels[offset + 1], pixels[offset + 2])) return;
                visited[index] = 1;
                queue[tail++] = index;
            };

            for (int x = 0; x < width; x++)
            {
                enqueue(x, 0);
                enqueue(x, height - 1);
            }
            for (int y = 1; y < height - 1; y++)
            {
                enqueue(0, y);
                enqueue(width - 1, y);
            }

            while (head < tail)
            {
                int index = queue[head++];
                int x = index % width;
                int y = index / width;
                int offset = y * stride + x * 4;
                pixels[offset + 3] = 0;

                if (x > 0) enqueue(x - 1, y);
                if (x + 1 < width) enqueue(x + 1, y);
                if (y > 0) enqueue(x, y - 1);
                if (y + 1 < height) enqueue(x, y + 1);
            }

            Marshal.Copy(pixels, 0, bits.Scan0, byteCount);
            bitmap.UnlockBits(bits);
            bitmap.Save(outputPath, ImageFormat.Png);
        }
    }
}
'@
}

$resolvedInput = (Resolve-Path -LiteralPath $InputPath).Path
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
[CheckerBackground]::Remove($resolvedInput, $resolvedOutput)
