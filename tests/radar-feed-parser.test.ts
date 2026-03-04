import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canonicalizeRadarUrl,
  parseRadarFeedXml,
} from '../src/radar-feed';

test('parse radar feed xml reads rss entries', () => {
  const xml = `<?xml version="1.0"?>
  <rss version="2.0"><channel>
    <item>
      <title><![CDATA[New AI Tool]]></title>
      <link>https://example.com/tool?utm_source=x&ref=1</link>
      <description><![CDATA[<p>Fast &amp; useful</p>]]></description>
      <pubDate>Wed, 04 Mar 2026 08:00:00 GMT</pubDate>
    </item>
  </channel></rss>`;

  const entries = parseRadarFeedXml(xml);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.title, 'New AI Tool');
  assert.equal(entries[0]?.url, 'https://example.com/tool?utm_source=x&ref=1');
  assert.equal(entries[0]?.summary, 'Fast & useful');
  assert.ok(entries[0]?.publishedAt?.startsWith('2026-03-04T08:00:00'));
});

test('parse radar feed xml reads atom entries', () => {
  const xml = `<?xml version="1.0"?>
  <feed xmlns="http://www.w3.org/2005/Atom">
    <entry>
      <title>Agent Framework</title>
      <link rel="alternate" href="https://example.org/agent" />
      <summary>Latest release</summary>
      <updated>2026-03-04T09:30:00Z</updated>
    </entry>
  </feed>`;

  const entries = parseRadarFeedXml(xml);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.title, 'Agent Framework');
  assert.equal(entries[0]?.url, 'https://example.org/agent');
  assert.equal(entries[0]?.summary, 'Latest release');
  assert.equal(entries[0]?.publishedAt, '2026-03-04T09:30:00.000Z');
});

test('canonicalize radar url removes tracking params and hash', () => {
  const actual = canonicalizeRadarUrl(
    'https://EXAMPLE.com/path/?utm_source=abc&b=2&a=1#frag',
  );
  assert.equal(actual, 'https://example.com/path?a=1&b=2');
});
