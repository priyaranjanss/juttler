import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toSlackMrkdwn } from './slackFormat';

describe('toSlackMrkdwn', () => {
  it('converts markdown bold and links', () => {
    assert.equal(toSlackMrkdwn('See **ICS-9** at [ticket](https://example.com/x)'), 'See *ICS-9* at <https://example.com/x|ticket>');
  });

  it('strips tool markup', () => {
    assert.equal(toSlackMrkdwn('Hi <dots_function_call>x</dots_function_call> there'), 'Hi  there');
  });

  it('converts a raw Slack user id to a native mention without double-wrapping mentions', () => {
    assert.equal(
      toSlackMrkdwn('Hi U0C4APM1B6Z and <@U0C4APM1B6Z>', 'U0C4APM1B6Z'),
      'Hi <@U0C4APM1B6Z> and <@U0C4APM1B6Z>'
    );
  });

  it('converts only chosen channel names into native mentions', () => {
    assert.equal(
      toSlackMrkdwn('Hi @Sonal, can you check this?', undefined, [
        { userId: 'U0SONAL', names: ['Sonal', 'sonal.s'] },
      ]),
      'Hi <@U0SONAL>, can you check this?'
    );
    assert.equal(
      toSlackMrkdwn('This is about the release.', undefined, [
        { userId: 'U0SONAL', names: ['Sonal'] },
      ]),
      'This is about the release.'
    );
  });

  it('preserves the required sender mention at the start of a reply', () => {
    assert.equal(
      toSlackMrkdwn('<@U0SONAL> I am talking about @Alex.', 'U0PRIYA', [
        { userId: 'U0SONAL', names: ['Sonal'] },
        { userId: 'U0ALEX', names: ['Alex'] },
      ]),
      '<@U0SONAL> I am talking about <@U0ALEX>.'
    );
  });
});
