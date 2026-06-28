"""
Called by update-prices.yml to bake exchange rates into data/rates.json.
Reads: /tmp/rates_raw.json  (fetched server-side by curl — avoids client CORS)
Writes: data/rates.json in the same structure as the fawazahmed0 CDN API
        so the frontend can switch between local and CDN with zero schema changes.
"""
import json
import sys

try:
    with open('/tmp/rates_raw.json') as f:
        data = json.load(f)

    usd = data.get('usd', {})
    npr = usd.get('npr', 0)

    if not npr:
        print('No NPR rate in CDN response — keeping existing rates.json')
        sys.exit(0)

    # Same structure as fawazahmed0 API: { "date": "...", "usd": { "npr": ..., ... } }
    output = {'date': data.get('date', ''), 'usd': usd}
    with open('data/rates.json', 'w') as f:
        json.dump(output, f, separators=(',', ':'))

    print(f"rates.json: npr={npr:.4f}, {len(usd)} currencies, date={data.get('date', '')}")

except Exception as e:
    print(f'rates.json update skipped: {e}')
