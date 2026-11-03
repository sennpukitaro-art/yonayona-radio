#!/usr/bin/env python3
"""Summarize radio_metric JSON lines from exported server logs. No identifiers."""
import argparse
import json
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone

EVENTS = {'page_view', 'matching_attempt', 'matched_participant', 'listener_join',
          'conversation', 'conversation_participant'}
SOURCES = {'direct', 'x', 'hiromeba', 'tsukutta', 'appvillage', 'viibo',
           'freesoft100', 'tsukurulog', 'share', 'internal', 'other'}
JST = timezone(timedelta(hours=9))


def summarize(lines, date=None):
    counts = Counter()
    for line in lines:
        # Render log exports may add a timestamp before the JSON object.
        start = line.find('{')
        if start < 0:
            continue
        try:
            entry = json.loads(line[start:])
            if not isinstance(entry, dict) or entry.get('type') != 'radio_metric':
                continue
            event = entry.get('event')
            if event not in EVENTS:
                continue
            when = datetime.fromisoformat(entry['time'].replace('Z', '+00:00'))
            if when.tzinfo is None:
                continue
            day = when.astimezone(JST).date().isoformat()
            if date and date != day:
                continue
            source = entry.get('source', 'other')
            if not isinstance(source, str) or source not in SOURCES:
                source = 'other'
            if event == 'conversation':
                source = 'all'
            counts[day, source, event] += 1
        except (ValueError, KeyError, TypeError, AttributeError):
            continue
    return counts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('log', nargs='?', help='Exported log file; stdin if omitted')
    parser.add_argument('--date', help='Japan-time date, YYYY-MM-DD')
    args = parser.parse_args()
    if args.date:
        try:
            datetime.strptime(args.date, '%Y-%m-%d')
        except ValueError:
            parser.error('--date must be YYYY-MM-DD')
    if args.log:
        with open(args.log, encoding='utf-8') as handle:
            counts = summarize(handle, args.date)
    else:
        counts = summarize(sys.stdin, args.date)
    print('date_jst,source,event,count')
    for (day, source, event), count in sorted(counts.items()):
        print(f'{day},{source},{event},{count}')


if __name__ == '__main__':
    main()
