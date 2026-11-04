#!/usr/bin/env python3
"""Create a self-contained, offline HTML report from metrics CSV or server logs."""

import argparse
import csv
import io
import json
import re
import sys
from collections import Counter
from datetime import date
from pathlib import Path

from summarize_metrics import EVENTS, SOURCES, summarize

FIELDS = {'date_jst', 'source', 'event', 'count'}
MAX_SAFE_INTEGER = 2 ** 53 - 1


def read_counts(text, input_format='auto'):
    """Return normalized counts and the detected format; invalid CSV fails closed.

    Log parsing intentionally uses the existing summarizer, including its JST
    conversion, allowlist and handling of non-metric/malformed log lines.
    """
    text = text.lstrip('\ufeff')
    if input_format == 'auto':
        first = next((line for line in text.splitlines() if line.strip()), '')
        header = next(csv.reader([first]), [])
        input_format = 'csv' if FIELDS.intersection(header) else 'log'
    if input_format == 'log':
        return summarize(io.StringIO(text)), 'log'
    if input_format != 'csv':
        raise ValueError('input format must be auto, csv or log')

    reader = csv.DictReader(io.StringIO(text.lstrip()), strict=True)
    if not reader.fieldnames or set(reader.fieldnames) != FIELDS or len(reader.fieldnames) != 4:
        raise ValueError('CSV header must contain date_jst,source,event,count exactly once')
    counts = Counter()
    for row in reader:
        line = reader.line_num
        if None in row or any(value is None for value in row.values()):
            raise ValueError(f'CSV line {line}: expected four fields')
        day, event = row['date_jst'].strip(), row['event'].strip()
        try:
            if not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', day):
                raise ValueError
            date.fromisoformat(day)
        except ValueError:
            raise ValueError(f'CSV line {line}: invalid date_jst (expected YYYY-MM-DD)') from None
        if event not in EVENTS:
            raise ValueError(f'CSV line {line}: unknown event')
        raw_count = row['count'].strip()
        if not re.fullmatch(r'[0-9]+', raw_count) or len(raw_count) > 16:
            raise ValueError(f'CSV line {line}: count must be a non-negative safe integer')
        count = int(raw_count)
        source = row['source'].strip()
        if event == 'conversation':
            source = 'all'
        elif source == 'all':
            raise ValueError(f'CSV line {line}: source=all is reserved for conversation')
        elif source not in SOURCES:
            source = 'other'
        counts[day, source, event] += count
    validate_totals(counts)
    return counts, 'csv'


def validate_totals(counts):
    totals = Counter()
    for (day, source, event), count in counts.items():
        totals[event] += count
        if count > MAX_SAFE_INTEGER or totals[event] > MAX_SAFE_INTEGER:
            raise ValueError('Event total exceeds the safe integer range for the HTML report')


def render_report(counts, input_format, sample=False):
    validate_totals(counts)
    payload = {
        'sample': sample,
        'input_format': input_format,
        'rows': [dict(date_jst=day, source=source, event=event, count=count)
                 for (day, source, event), count in sorted(counts.items())],
    }
    # Never embed input lines, paths, names, URLs, or other original log fields.
    encoded = json.dumps(payload, ensure_ascii=True, separators=(',', ':'))
    encoded = encoded.replace('&', '\\u0026').replace('<', '\\u003c').replace('>', '\\u003e')
    root = Path(__file__).resolve().parent
    template = (root / 'metrics_report.html').read_text(encoding='utf-8')
    script = (root / 'metrics_report_ui.js').read_text(encoding='utf-8')
    return template.replace('__REPORT_DATA__', encoded).replace('__REPORT_UI__', script)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', nargs='?', default='-', help='Summary CSV or exported text log; - for stdin')
    parser.add_argument('--format', choices=['auto', 'csv', 'log'], default='auto', help='Input format (default: auto)')
    parser.add_argument('-o', '--output', default='reports/metrics-report.html', help='Local HTML output path')
    parser.add_argument('--sample', action='store_true', help='Mark synthetic data clearly throughout the report')
    args = parser.parse_args(argv)
    try:
        output = Path(args.output)
        if args.input != '-' and Path(args.input).resolve() == output.resolve():
            raise ValueError('Input and output must be different files')
        text = sys.stdin.read() if args.input == '-' else Path(args.input).read_text(encoding='utf-8-sig')
        counts, detected = read_counts(text, args.format)
        html = render_report(counts, detected, args.sample)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(html, encoding='utf-8')
    except (OSError, UnicodeError, ValueError, csv.Error) as error:
        parser.exit(2, f'metrics_report: {error}\n')
    print(f'Created {output} ({detected}; counts only, not unique people or conversion rates)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
