#!/usr/bin/env python3
"""Prepare Animals.zip for private upload. Requires: pip install pymupdf.
Run from repo root: python supabase/scripts/prepare-animals.py /path/to/Animals.zip
Full worksheets stay in git-ignored backend/protected; only small previews are public.
"""
import re
import sys
import zipfile
from pathlib import Path
import fitz

root = Path(__file__).resolve().parents[2]
private = root / 'backend/protected/vocab-animals'
thumb = root / 'frontend/public/sheets/vocab-animals/thumb'
with zipfile.ZipFile(sys.argv[1]) as archive:
    files = {}
    for name in archive.namelist():
        match = re.fullmatch(r'Animals/Animals\s+(\d+)\s*\.pdf', name)
        if match:
            number = int(match[1])
            if number in files:
                raise ValueError(f'Duplicate worksheet {number}')
            files[number] = archive.read(name)
    if set(files) != set(range(1, 11)):
        raise ValueError('Expected exactly Animals 1 through Animals 10')
    for number, data in sorted(files.items()):
        doc = fitz.open(stream=data, filetype='pdf')
        if len(doc) != 2:
            raise ValueError(f'Animals {number} must have two pages')
        private.mkdir(parents=True, exist_ok=True)
        thumb.mkdir(parents=True, exist_ok=True)
        (private / f'animals-{number}.pdf').write_bytes(data)
        for page_number, page in enumerate(doc, 1):
            page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5)).save(private / f'animals-{number}-{page_number}.jpg')
        page = doc[0]
        page.get_pixmap(matrix=fitz.Matrix(300 / page.rect.width, 300 / page.rect.width)).save(thumb / f'animals-{number}.jpg')
        doc.close()
print('Prepared 10 unchanged PDFs, 20 private page images and 10 public thumbnails.')
