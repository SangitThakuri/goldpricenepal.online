"""
Called by update-prices.yml after a successful FENEGOSIDA scrape.
Reads env vars: GOLD, SILVER, DATE, TIMESTAMP
Writes: data/prices.json (with prev-day fields), data/history.json
"""
import json
import os
import sys

gold      = int(os.environ['GOLD'])
silver    = int(os.environ['SILVER'])
date      = os.environ['DATE']
timestamp = os.environ['TIMESTAMP']
hist_path  = 'data/history.json'
price_path = 'data/prices.json'

try:
    with open(hist_path) as f:
        history = json.load(f)
except Exception:
    history = []

# Most-recent entry strictly before today → yesterday's FENEGOSIDA price
prev_entries = sorted([h for h in history if h.get('date', '') < date], key=lambda x: x['date'])
prev        = prev_entries[-1] if prev_entries else {}
gold_prev   = prev.get('gold24k', 0)
silver_prev = prev.get('silver',  0)

# prices.json — include prev-day so frontend never needs external CDN for change pill
prices_data = {
    'gold24kTola':     gold,
    'silverTola':      silver,
    'gold24kTolaPrev': gold_prev,
    'silverTolaPrev':  silver_prev,
    'updatedAt':       timestamp,
}
with open(price_path, 'w') as f:
    json.dump(prices_data, f, separators=(',', ':'))
print(f'prices.json: gold={gold} (prev={gold_prev}), silver={silver} (prev={silver_prev})')

# history.json — upsert today, keep newest 730 days
history = [h for h in history if h.get('date') != date]
history.append({'date': date, 'gold24k': gold, 'silver': silver})
history.sort(key=lambda x: x['date'])
history = history[-730:]
with open(hist_path, 'w') as f:
    json.dump(history, f, separators=(',', ':'))
print(f'history.json: {len(history)} records, latest={history[-1]}')
