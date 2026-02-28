import test from 'node:test';
import assert from 'node:assert/strict';

import { parseSkillsSearchOutput } from '../src/skills-search-parser.ts';

const SAMPLE_OUTPUT = `\x1b[38;5;145mobra/superpowers@brainstorming\x1b[0m \x1b[36m31.2K installs\x1b[0m
\x1b[38;5;102m└ https://skills.sh/obra/superpowers/brainstorming\x1b[0m

\x1b[38;5;145mobra/superpowers@systematic-debugging\x1b[0m \x1b[36m17K installs\x1b[0m
\x1b[38;5;102m└ https://skills.sh/obra/superpowers/systematic-debugging\x1b[0m`;

test('parses skills output lines with install count suffix', () => {
  const results = parseSkillsSearchOutput(SAMPLE_OUTPUT);

  assert.deepEqual(results, [
    {
      package: 'obra/superpowers@brainstorming',
      url: 'https://skills.sh/obra/superpowers/brainstorming',
      installs: '31.2K',
    },
    {
      package: 'obra/superpowers@systematic-debugging',
      url: 'https://skills.sh/obra/superpowers/systematic-debugging',
      installs: '17K',
    },
  ]);
});
