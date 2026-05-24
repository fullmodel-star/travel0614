import os
from PIL import Image, ImageDraw

def draw_icon(size):
    # 建立具有透明背景的圖像
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    s = size / 512.0  # 縮放比例基數
    
    # 1. 繪製漸層背景
    # 建立一個大尺寸漸層，避免低解析度時有鋸齒，然後利用像素填充
    bg = Image.new("RGBA", (size, size))
    for y in range(size):
        for x in range(size):
            factor = (x + y) / (2.0 * size)
            # 從 #142c33 (20, 44, 51) 漸層到 #2c5f8a (44, 95, 138)
            r = int(20 + factor * (44 - 20))
            g = int(44 + factor * (95 - 44))
            b = int(51 + factor * (138 - 51))
            bg.putpixel((x, y), (r, g, b, 255))
            
    # 2. 建立圓角遮罩 (112px 圓角半徑在 512px 下)
    mask = Image.new("L", (size, size), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle([0, 0, size, size], radius=int(112 * s), fill=255)
    
    # 將圓角套用到漸層背景
    icon_img = Image.new("RGBA", (size, size))
    icon_img.paste(bg, (0, 0), mask=mask)
    
    # 3. 繪製圖形元素
    draw = ImageDraw.Draw(icon_img)
    
    # 3.1 繪製白邊飾框
    draw.rounded_rectangle(
        [int(16 * s), int(16 * s), size - int(16 * s), size - int(16 * s)], 
        radius=int(96 * s), 
        outline=(255, 255, 255, 25), 
        width=int(4 * s)
    )
    
    # 3.2 繪製羅盤背景線條 (半透明白色)
    cx, cy = size / 2.0, size / 2.0
    # 外圈
    draw.ellipse([cx - 180*s, cy - 180*s, cx + 180*s, cy + 180*s], outline=(255, 255, 255, 15), width=int(2 * s))
    # 內圈
    draw.ellipse([cx - 110*s, cy - 110*s, cx + 110*s, cy + 110*s], outline=(255, 255, 255, 15), width=int(2 * s))
    # 交叉線
    draw.line([cx, 40*s, cx, size - 40*s], fill=(255, 255, 255, 15), width=int(2 * s))
    draw.line([40*s, cy, size - 40*s, cy], fill=(255, 255, 255, 15), width=int(2 * s))
    draw.line([103*s, 103*s, size - 103*s, size - 103*s], fill=(255, 255, 255, 15), width=int(2 * s))
    draw.line([size - 103*s, 103*s, 103*s, size - 103*s], fill=(255, 255, 255, 15), width=int(2 * s))
    
    # 3.3 繪製山脈
    # 後方山脈 (多洛米堤 style) - 右半暗面
    draw.polygon([(340*s, 380*s), (430*s, 220*s), (480*s, 380*s)], fill=(120, 97, 72, 255))
    # 後方山脈 - 左半亮面
    draw.polygon([(340*s, 380*s), (430*s, 220*s), (380*s, 380*s)], fill=(214, 195, 173, 255))
    
    # 左後方小山頭
    draw.polygon([(80*s, 380*s), (150*s, 280*s), (220*s, 380*s)], fill=(115, 144, 172, 120))
    
    # 主峰 (馬特洪峰 style) - 左半暗面
    draw.polygon([(256*s, 120*s), (100*s, 380*s), (256*s, 380*s)], fill=(115, 144, 172, 255))
    # 主峰 - 右半亮面
    draw.polygon([(256*s, 120*s), (256*s, 380*s), (412*s, 380*s)], fill=(227, 236, 245, 255))
    
    # 主峰雪線細節 (正面覆雪)
    draw.polygon([(256*s, 120*s), (216*s, 190*s), (236*s, 185*s), (256*s, 210*s), (276*s, 180*s), (296*s, 195*s)], fill=(255, 255, 255, 240))
    # 主峰雪線暗面覆雪
    draw.polygon([(256*s, 120*s), (216*s, 190*s), (236*s, 185*s), (256*s, 210*s)], fill=(227, 236, 245, 240))
    
    # 山脈底座底線
    draw.rounded_rectangle([80*s, 375*s, 432*s, 388*s], radius=int(6*s), fill=(20, 44, 51, 80))
    
    # 3.4 繪製指南針指針 (底部)
    def draw_poly_offset(pts, fx, fy, fill_color):
        offset_pts = [(fx + px * 0.85 * s, fy + py * 0.85 * s) for px, py in pts]
        draw.polygon(offset_pts, fill=fill_color)
        
    px, py = 256 * s, 420 * s
    # 北針 (紅色)
    draw_poly_offset([(0,0), (-8,-25), (0,-35)], px, py, (231, 76, 60, 255))
    draw_poly_offset([(0,0), (8,-25), (0,-35)], px, py, (192, 57, 43, 255))
    # 西針
    draw_poly_offset([(0,0), (-20,-5), (-30,0)], px, py, (207, 216, 220, 255))
    draw_poly_offset([(0,0), (-20,5), (-30,0)], px, py, (144, 164, 174, 255))
    # 東針
    draw_poly_offset([(0,0), (20,-5), (30,0)], px, py, (207, 216, 220, 255))
    draw_poly_offset([(0,0), (20,5), (30,0)], px, py, (144, 164, 174, 255))
    # 南針
    draw_poly_offset([(0,0), (5,-20), (0,-30)], px, py, (207, 216, 220, 100))
    
    # 3.5 繪製地圖標記 (Pin) 指向主峰山頂
    pin_y = 95 * s
    pin_x = 256 * s
    # 繪製紅色地圖標記圓頭
    draw.ellipse([pin_x - 26*s, pin_y - 72*s, pin_x + 26*s, pin_y - 20*s], fill=(231, 76, 60, 255))
    # 繪製定位針尖三角
    draw.polygon([(pin_x - 20*s, pin_y - 30*s), (pin_x + 20*s, pin_y - 30*s), (pin_x, pin_y)], fill=(231, 76, 60, 255))
    # 繪製定位針中心小圓圈
    draw.ellipse([pin_x - 9*s, pin_y - 46*s, pin_x + 9*s, pin_y - 28*s], fill=(255, 255, 255, 255))
    
    return icon_img

def main():
    print("開始產生 PWA 圖示資源...")
    # 定義輸出的規格
    sizes = {
        "icon-192.png": 192,
        "icon-512.png": 512,
        "apple-touch-icon.png": 180
    }
    
    for filename, size in sizes.items():
        filepath = os.path.join(os.getcwd(), filename)
        print(f"正在繪製 {filename} ({size}x{size})...")
        img = draw_icon(size)
        img.save(filepath, "PNG")
        print(f"已儲存：{filepath}")
        
    print("PWA 圖示資源產生完畢！")

if __name__ == "__main__":
    main()
