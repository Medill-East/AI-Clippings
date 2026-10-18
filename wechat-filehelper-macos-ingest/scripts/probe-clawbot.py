#!/usr/bin/env python3
"""Receive-only iLink diagnostic; no LLM, replies, or media downloads.
Protocol: https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol.md
Private state and sanitized message payloads live under ignored local/.
"""
import argparse
import base64
import json
import os
from pathlib import Path
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1] / 'local' / 'clawbot-probe'
BASE = 'https://ilinkai.weixin.qq.com'
VERSION = '2.4.10'  # official reference inspected 2026-10-18

def save(name, value):
    ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = ROOT / name
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)

def read(name):
    return json.loads((ROOT / name).read_text())

def trusted_base(value):
    u = urllib.parse.urlparse(value)
    if u.scheme != 'https' or not (u.hostname or '').endswith('.weixin.qq.com') or u.username or u.port:
        raise ValueError('untrusted API host')
    return value.rstrip('/')

def request(endpoint, body=None, token=None, base=BASE):
    headers = {'iLink-App-Id': 'bot', 'iLink-App-ClientVersion': str(2*65536+4*256+10)}
    data = None
    if body is not None:
        headers.update({'Content-Type': 'application/json', 'AuthorizationType': 'ilink_bot_token',
                        'X-WECHAT-UIN': base64.b64encode(str(secrets.randbits(32)).encode()).decode()})
        if token:
            headers['Authorization'] = 'Bearer ' + token
        data = json.dumps(body).encode()
    req = urllib.request.Request(trusted_base(base) + '/' + endpoint, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=45) as response:
        result = json.load(response)
    if any(result.get(k, 0) not in (0, None) for k in ('ret', 'errcode')):
        raise RuntimeError('API rejected request: ret=%s errcode=%s' % (result.get('ret'), result.get('errcode')))
    return result

def redact(value):
    if isinstance(value, dict):
        return {k: ('[redacted]' if k in {'bot_token','context_token','aes_key','aeskey','encrypt_query_param','get_updates_buf'}
                    else redact(v)) for k,v in value.items()}
    if isinstance(value, list):
        return [redact(v) for v in value]
    return value

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('command', choices=['qr','login','listen'])
    p.add_argument('--seconds', type=int, default=180)
    a = p.parse_args()
    if not 1 <= a.seconds <= 300:
        p.error('--seconds must be 1..300')
    if a.command == 'qr':
        result = request('ilink/bot/get_bot_qrcode?bot_type=3', {'local_token_list': []})
        if not result.get('qrcode') or not result.get('qrcode_img_content'):
            raise RuntimeError('missing QR fields')
        save('qr.json', result)
        save('login-progress.json', {'status':'waiting_for_scan','created_at':time.time()})
        print('QR_READY (private local/qr.json)', flush=True)
        return
    if a.command == 'login':
        qr = read('qr.json')['qrcode']
        base = BASE
        deadline = time.monotonic() + a.seconds
        for attempt in range(20):
            if time.monotonic() >= deadline:
                break
            result = request('ilink/bot/get_qrcode_status?' + urllib.parse.urlencode({'qrcode':qr}), base=base)
            status = result.get('status','unknown')
            save('login-progress.json', {'status':status,'checked_at':time.time()})
            print('LOGIN_STATUS', status, flush=True)
            if status == 'confirmed':
                if not result.get('bot_token'):
                    raise RuntimeError('confirmed without token')
                result['baseurl'] = trusted_base(result.get('baseurl') or base)
                save('credentials.json', result)
                return
            if status == 'scaned_but_redirect':
                base = trusted_base('https://' + result['redirect_host'])
            elif status not in ('wait','scaned'):
                return  # expired/verification: explicit user follow-up, no silent retries
            time.sleep(2)
        print('LOGIN_WINDOW_ENDED', flush=True)
        return
    creds = read('credentials.json')
    cursor_file = ROOT / 'cursor.json'
    cursor = read('cursor.json').get('cursor','') if cursor_file.exists() else ''
    deadline = time.monotonic() + a.seconds
    count = 0
    for attempt in range(20):
        if time.monotonic() >= deadline:
            break
        start = time.monotonic()
        result = request('ilink/bot/getupdates', {'get_updates_buf':cursor,
                         'base_info':{'channel_version':VERSION,'bot_agent':'ClippingsProbe/0.1'}},
                         token=creds['bot_token'], base=creds['baseurl'])
        messages = result.get('msgs', [])
        for msg in messages:
            name = 'message-%s-%s.json' % (time.time_ns(), count)
            save(name, redact(msg))  # persist before advancing cursor
            count += 1
            items = msg.get('item_list', [])
            print(json.dumps({'saved':name,'item_types':[i.get('type') for i in items],
                              'item_keys':[list(i) for i in items]}, ensure_ascii=False), flush=True)
        cursor = result.get('get_updates_buf') or cursor
        save('cursor.json', {'cursor':cursor})
        save('receive-status.json', {'checked_at':time.time(),'received_this_run':count,'polls':attempt+1})
        if time.monotonic() - start < 2:
            time.sleep(2)
    print('RECEIVE_WINDOW_ENDED count=%s' % count, flush=True)

if __name__ == '__main__':
    try:
        main()
    except urllib.error.HTTPError as e:
        print('HTTP_ERROR', e.code, flush=True)
        raise SystemExit(1)
    except Exception as e:
        # Do not print response bodies, URLs, or credentials in transport errors.
        print('PROBE_FAILED', type(e).__name__, flush=True)
        raise SystemExit(1)
