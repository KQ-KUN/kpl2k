"""Export the existing verified team icon bytes to local content-addressed files."""
from __future__ import annotations
import argparse
import base64
import hashlib
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def export(source: Path, app: Path):
    data=json.loads(source.read_text(encoding='utf-8'));icons={};original=0
    for fid,value in sorted(data['icons'].items()):
        if value.startswith('data:image/png;base64,'):
            raw=base64.b64decode(value.split(',',1)[1],validate=True)
            if not raw.startswith(b'\x89PNG\r\n\x1a\n'):raise ValueError(f'Invalid PNG: {fid}')
            rel=f'assets/team-icons/{hashlib.sha256(raw).hexdigest()[:24]}.png'
            target=app/rel;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(raw);original+=len(value)
        else:
            target=(app/value).resolve()
            if not target.is_relative_to(app.resolve()) or not target.is_file():raise ValueError(f'Missing local icon: {fid}')
            rel=value
        icons[fid]=rel
    result={**data,'icons':icons};(app/'data/team_icons.json').write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    return {'icons':len(icons),'decodedDataUriCharacters':original,'mappingBytes':(app/'data/team_icons.json').stat().st_size}
def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--source',type=Path,default=ROOT/'app/data/team_icons.json');parser.add_argument('--app',type=Path,default=ROOT/'app');a=parser.parse_args();print(export(a.source,a.app))
if __name__=='__main__':main()
