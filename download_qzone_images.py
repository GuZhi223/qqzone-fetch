import json
import csv
import io
import os
import re
import sys
import time
import requests
from PIL import Image


def to_original_url(url):
    return re.sub(r'!/(?:m|c|s)(?=&|$)', '!/b', url)


def collect_image_urls(file_path):
    urls = set()
    ext = os.path.splitext(file_path)[1].lower()

    if ext == '.json':
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        for item in data:
            if isinstance(item.get('images'), list):
                for u in item['images']:
                    if u.startswith('https://') and 'qpic.cn' in u:
                        urls.add(to_original_url(u.replace('&amp;', '&')))
            content = item.get('content', '')
            for u in re.findall(r'https?://[^\s,")\]]+', content):
                if 'qpic.cn' in u or 'photo.store.qq.com' in u:
                    urls.add(to_original_url(u.replace('&amp;', '&')))

    elif ext == '.csv':
        with open(file_path, 'r', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            for row in reader:
                for key in row:
                    val = row[key] or ''
                    if 'qpic.cn' in val or 'photo.store.qq.com' in val:
                        for u in re.findall(r'https?://[^\s,")\]]+', val):
                            if 'qpic.cn' in u or 'photo.store.qq.com' in u:
                                urls.add(to_original_url(u.replace('&amp;', '&')))
    else:
        print(f'不支持的文件格式: {ext}')
        return set()

    return urls


def sanitize_filename(url, index):
    name = f'img_{index:04d}'
    try:
        if 'qpic.cn/psc' in url:
            params = url.split('?', 1)[1] if '?' in url else ''
            bo_match = re.search(r'bo=([^&]+)', params)
            if bo_match:
                name = bo_match.group(1)[:20]
            else:
                sig = re.sub(r'[^a-zA-Z0-9]', '', params)[:32]
                if sig:
                    name = sig
        else:
            path = url.split('?')[0]
            basename = os.path.basename(path)
            if basename and basename != '/':
                name = os.path.splitext(basename)[0]
    except Exception:
        pass
    return f'{name}_{index:04d}.jpg'


def download_images(urls, output_dir, referer='https://user.qzone.qq.com/'):
    os.makedirs(output_dir, exist_ok=True)

    session = requests.Session()
    session.headers.update({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
        'Referer': referer,
        'Accept': 'image/jpeg,image/png,image/*;q=0.8',
    })

    total = len(urls)
    success = 0
    failed = 0
    skipped = 0

    print(f'共 {total} 张图片，保存到: {output_dir}')
    print('-' * 50)

    for i, url in enumerate(sorted(urls), 1):
        filename = sanitize_filename(url, i)
        filepath = os.path.join(output_dir, filename)

        if os.path.exists(filepath):
            print(f'[{i}/{total}] 跳过已存在: {filename}')
            skipped += 1
            continue

        try:
            resp = session.get(url, timeout=30)
            resp.raise_for_status()

            content_type = resp.headers.get('Content-Type', '')
            if 'image' not in content_type and len(resp.content) < 100:
                print(f'[{i}/{total}] 跳过非图片: {filename} ({content_type})')
                skipped += 1
                continue

            if 'webp' in content_type:
                try:
                    img = Image.open(io.BytesIO(resp.content))
                    if img.mode in ('RGBA', 'PA'):
                        img = img.convert('RGB')
                    img.save(filepath, 'JPEG', quality=95)
                    print(f'[{i}/{total}] 下载成功 (webp→jpg): {filename} ({len(resp.content)/1024:.1f} KB)')
                except Exception as e:
                    print(f'[{i}/{total}] 转换失败: {filename} - {e}')
                    failed += 1
                    continue
            else:
                with open(filepath, 'wb') as f:
                    f.write(resp.content)
                size_kb = len(resp.content) / 1024
                print(f'[{i}/{total}] 下载成功: {filename} ({size_kb:.1f} KB)')

            success += 1
            time.sleep(0.3)

        except Exception as e:
            print(f'[{i}/{total}] 下载失败: {filename} - {e}')
            failed += 1

    print('-' * 50)
    print(f'完成! 成功: {success}, 失败: {failed}, 跳过: {skipped}, 共计: {total}')


def main():
    if len(sys.argv) > 1:
        file_path = sys.argv[1]
    else:
        file_path = input('请输入导出的JSON或CSV文件路径: ').strip().strip('"')

    if not os.path.isfile(file_path):
        print(f'文件不存在: {file_path}')
        sys.exit(1)

    print(f'正在解析: {os.path.basename(file_path)}')
    urls = collect_image_urls(file_path)

    if not urls:
        print('未找到任何图片链接!')
        sys.exit(0)

    print(f'找到 {len(urls)} 张图片')

    default_dir = os.path.join(os.path.dirname(os.path.abspath(file_path)), 'qzone_images')
    output_dir = input(f'保存目录 (默认 {default_dir}): ').strip().strip('"') or default_dir

    download_images(urls, output_dir)


if __name__ == '__main__':
    main()
