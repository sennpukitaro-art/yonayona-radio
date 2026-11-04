import io
import json
import pathlib
import re
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import metrics_report as report

FIXTURES = ROOT / 'tests' / 'fixtures'
HEADER = 'date_jst,source,event,count\n'


class ReportTest(unittest.TestCase):
    def test_csv_and_exported_log_have_identical_counts(self):
        csv_counts, csv_format = report.read_counts((FIXTURES / 'metrics-summary.csv').read_text())
        log_counts, log_format = report.read_counts((FIXTURES / 'metrics-export.txt').read_text())
        self.assertEqual(csv_format, 'csv')
        self.assertEqual(log_format, 'log')
        self.assertEqual(csv_counts, log_counts)
        totals = {event: sum(value for (_, _, name), value in csv_counts.items() if name == event)
                  for event in ['page_view', 'matching_attempt', 'matched_participant',
                                'conversation_participant', 'conversation']}
        self.assertEqual(totals, dict(page_view=16, matching_attempt=10, matched_participant=8,
                                     conversation_participant=6, conversation=3))
        self.assertEqual(csv_counts['2026-11-03', 'x', 'page_view'], 5)

    def test_log_jst_boundary_and_invalid_lines(self):
        def event(time, source='x', kind='page_view'):
            return json.dumps(dict(type='radio_metric', time=time, source=source, event=kind))
        lines = [event('2026-11-02T14:59:59Z'), 'prefix ' + event('2026-11-02T15:00:00Z'),
                 event('2026-11-03T00:00:00+09:00'), event('2026-11-02T15:00:00'),
                 event('bad'), event('2026-11-02T15:00:00Z', source='private@example.test'),
                 event('2026-11-02T15:00:00Z', kind='conversation'), '{broken}', '[]', 'startup']
        counts, _ = report.read_counts('\n'.join(lines))
        self.assertEqual(dict(counts), {('2026-11-02', 'x', 'page_view'): 1,
                                       ('2026-11-03', 'x', 'page_view'): 2,
                                       ('2026-11-03', 'other', 'page_view'): 1,
                                       ('2026-11-03', 'all', 'conversation'): 1})

    def test_csv_bom_reordered_headers_quotes_and_duplicates(self):
        text = '\ufeffevent,count,source,date_jst\r\n"page_view",2,x,2026-11-03\r\npage_view,3,x,2026-11-03\r\n'
        counts, _ = report.read_counts(text)
        self.assertEqual(dict(counts), {('2026-11-03', 'x', 'page_view'): 5})

    def test_csv_normalizes_source_and_conversation_without_copying_private_fields(self):
        text = HEADER + '2026-11-03,private@example.test,page_view,3\n2026-11-03,x,conversation,1\n'
        counts, _ = report.read_counts(text)
        self.assertEqual(dict(counts), {('2026-11-03', 'other', 'page_view'): 3,
                                       ('2026-11-03', 'all', 'conversation'): 1})
        self.assertNotIn('private@example.test', report.render_report(counts, 'csv'))

    def test_invalid_csv_is_rejected_instead_of_silently_showing_zero(self):
        invalid = [
            'date_jst,source,event\n2026-11-03,x,page_view\n',
            'date_jst,source,event,count,count\n',
            HEADER + '2026-11-03,x,page_view\n',
            HEADER + '2026-11-03,x,page_view,1,extra\n',
            HEADER + '2026-02-30,x,page_view,1\n',
            HEADER + '2026-1-3,x,page_view,1\n',
            HEADER + '2026-11-03,x,page_view,-1\n',
            HEADER + '2026-11-03,x,page_view,1.2\n',
            HEADER + '2026-11-03,x,page_view,NaN\n',
            HEADER + '2026-11-03,x,typo,1\n',
            HEADER + '2026-11-03,all,page_view,1\n',
            HEADER + f'2026-11-03,x,page_view,{2 ** 53}\n',
            HEADER + f'2026-11-03,x,page_view,{2 ** 53 - 1}\n2026-11-04,direct,page_view,1\n',
        ]
        for text in invalid:
            with self.subTest(text=text), self.assertRaises(ValueError):
                report.read_counts(text)

    def test_empty_csv_and_non_metric_logs_are_explicit_empty_reports(self):
        for text in ['', 'startup\n{broken}', HEADER]:
            counts, _ = report.read_counts(text)
            self.assertFalse(counts)
            html = report.render_report(counts, 'csv')
            self.assertIn('利用者0人を意味しません', html)
            self.assertIn('対象の記録がありません', html)

    def test_report_is_self_contained_and_includes_only_aggregates(self):
        event = dict(type='radio_metric', time='2026-11-02T15:00:00Z', event='page_view', source='x',
                     name='DO_NOT_COPY', ip='192.0.2.99', text='PRIVATE_CHAT', url='https://private.example/')
        counts, _ = report.read_counts(json.dumps(event), 'log')
        html = report.render_report(counts, 'log', sample=True)
        payload = json.loads(re.search(r'<script type="application/json" id="report-data">(.*?)</script>', html).group(1))
        self.assertEqual(payload['rows'], [dict(date_jst='2026-11-03', source='x', event='page_view', count=1)])
        self.assertTrue(payload['sample'])
        self.assertNotRegex(html, r'(?:src|href)=["\']https?://')
        self.assertIn("connect-src 'none'", html)
        self.assertIn('width=device-width', html)
        self.assertIn('実人数・正確なコンバージョン率は算出できません', html)
        for private in ['DO_NOT_COPY', '192.0.2.99', 'PRIVATE_CHAT', 'https://private.example/']:
            self.assertNotIn(private, html)
        self.assertNotIn('__REPORT_', html)

    def test_embedded_json_cannot_close_the_script(self):
        counts = {('2026-11-03', '</script><script>alert(1)</script>', 'page_view'): 1}
        html = report.render_report(counts, 'csv')
        payload = re.search(r'id="report-data">(.*?)</script>', html).group(1)
        self.assertNotIn('<', payload)
        self.assertEqual(json.loads(payload)['rows'][0]['source'], '</script><script>alert(1)</script>')

    def test_cli_writes_sample_and_supports_stdin(self):
        with tempfile.TemporaryDirectory() as temp:
            output = pathlib.Path(temp) / 'nested' / 'sample.html'
            result = subprocess.run([sys.executable, str(ROOT / 'scripts/metrics_report.py'),
                                     str(FIXTURES / 'metrics-summary.csv'), '--sample', '-o', str(output)],
                                    text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('"sample":true', output.read_text())
            with patch('sys.stdin', io.StringIO(HEADER)), redirect_stdout(io.StringIO()):
                self.assertEqual(report.main(['-', '--format', 'csv', '-o', str(output)]), 0)

    def test_cli_does_not_overwrite_input_or_existing_output_on_bad_csv(self):
        with tempfile.TemporaryDirectory() as temp:
            source = pathlib.Path(temp) / 'input.csv'
            source.write_text(HEADER + 'bad,x,page_view,1\n')
            output = pathlib.Path(temp) / 'report.html'
            output.write_text('previous report')
            for target in [output, source]:
                result = subprocess.run([sys.executable, str(ROOT / 'scripts/metrics_report.py'),
                                         str(source), '-o', str(target)], text=True, capture_output=True)
                self.assertEqual(result.returncode, 2)
            self.assertEqual(output.read_text(), 'previous report')
            self.assertTrue(source.read_text().startswith(HEADER))


if __name__ == '__main__':
    unittest.main()
