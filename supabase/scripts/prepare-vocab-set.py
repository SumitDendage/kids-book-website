#!/usr/bin/env python3
"""Prepare a Vocabulary zip of ten 2-page worksheets (the sheet, then its answers) for private upload.
Requires: pip install pymupdf. Run from repo root, e.g.
  python supabase/scripts/prepare-vocab-set.py "Parts of the body.zip" vocab-body-parts body
  python supabase/scripts/prepare-vocab-set.py "Animals and their babies.zip" vocab-animal-babies babies
Any PDF in the zip whose name ends in its number ("My body 3 .pdf") becomes <file>-<number>.pdf.
Full worksheets stay in git-ignored backend/protected; only small previews are public.
"""
import re
import sys
import zipfile
from pathlib import Path
import fitz

zip_path, folder, stem = sys.argv[1:4]
root = Path(__file__).resolve().parents[2]
private = root / 'backend/protected' / folder
thumb = root / 'frontend/public/sheets' / folder / 'thumb'
with zipfile.ZipFile(zip_path) as archive:
    files = {}
    for name in archive.namelist():
        match = re.fullmatch(r'[^/]+/[^/]*?(\d+)\s*\.pdf', name)
        if match:
            number = int(match[1])
            if number in files:
                raise ValueError(f'Duplicate worksheet {number}')
            files[number] = archive.read(name)
    if set(files) != set(range(1, 11)):
        raise ValueError(f'Expected worksheets 1 through 10, found {sorted(files)}')
    private.mkdir(parents=True, exist_ok=True)
    thumb.mkdir(parents=True, exist_ok=True)
    for number, data in sorted(files.items()):
        doc = fitz.open(stream=data, filetype='pdf')
        if len(doc) != 2:
            raise ValueError(f'Worksheet {number} must have two pages')
        (private / f'{stem}-{number}.pdf').write_bytes(data)
        for page_number, page in enumerate(doc, 1):
            page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5)).save(private / f'{stem}-{number}-{page_number}.jpg')
        page = doc[0]
        page.get_pixmap(matrix=fitz.Matrix(300 / page.rect.width, 300 / page.rect.width)).save(thumb / f'{stem}-{number}.jpg')
        doc.close()
print(f'Prepared 10 unchanged PDFs, 20 private page images and 10 public thumbnails in {folder}.')
