import importlib.util
import json
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('metrics', pathlib.Path(__file__).parents[1] / 'scripts/summarize_metrics.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class MetricsTest(unittest.TestCase):
    def test_japan_date_filter_and_untrusted_lines(self):
        def event(time, kind='page_view', source='x'):
            return json.dumps(dict(type='radio_metric', time=time, event=kind, source=source))
        lines = ['startup', '{bad}', 'prefix ' + event('2026-11-02T15:00:00Z'),
                 event('2026-11-02T14:59:59Z'), event('2026-11-02T15:01:00Z', 'conversation'),
                 event('2026-11-02T15:02:00Z', source='private@example.test'),
                 event('bad'), event('2026-11-02T15:00:00Z', 'not_allowed'), '[]']
        counts = module.summarize(lines, '2026-11-03')
        self.assertEqual(dict(counts), {('2026-11-03', 'x', 'page_view'): 1,
                                      ('2026-11-03', 'all', 'conversation'): 1,
                                      ('2026-11-03', 'other', 'page_view'): 1})


if __name__ == '__main__':
    unittest.main()
