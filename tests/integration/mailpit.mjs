import assert from 'node:assert/strict';
export async function emailLink(email, subject) {
  for (let i = 0; i < 60; i++) {
    const messages = await (
      await fetch('http://127.0.0.1:54324/api/v1/messages')
    ).json();
    const match = messages.messages.find(
      (m) =>
        m.To.some((t) => t.Address === email) &&
        m.Subject.toLowerCase().includes(subject),
    );
    if (match) {
      const { HTML } = await (
        await fetch('http://127.0.0.1:54324/api/v1/message/' + match.ID)
      ).json();
      const link = HTML.match(/href="([^"]+)"/i)?.[1].replaceAll('&amp;', '&');
      assert.equal(new URL(link).hostname, '127.0.0.1');
      return link;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Expected email was not delivered to local Mailpit.');
}
