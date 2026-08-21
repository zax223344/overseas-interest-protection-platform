# -*- coding: utf-8 -*-
"""生成 Android launcher 图标各密度"""
import os
from PIL import Image

SRC = r'C:\Users\28737\Desktop\新建文件夹\icons\icon-512.png'
BASE = r'C:\Users\28737\Desktop\新建文件夹\android-app\app\src\main\res'
DENSITIES = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}

logo = Image.open(SRC).convert('RGBA')
for dpi, size in DENSITIES.items():
    d = os.path.join(BASE, f'mipmap-{dpi}')
    os.makedirs(d, exist_ok=True)
    img = logo.resize((size, size), Image.LANCZOS)
    img.save(os.path.join(d, 'ic_launcher.png'), 'PNG')
    print('ok', dpi, size)
print('DONE')
