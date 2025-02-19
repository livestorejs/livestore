import { Schema } from '@livestore/utils/effect'

import { BackgroundMessage } from './background-message.js'

export class IframeReady extends Schema.TaggedStruct('IframeReady', {}) {}
export class EscapeKey extends Schema.TaggedStruct('EscapeKey', {}) {}

export class MessageToIframeWindow extends Schema.Union() {}
export class MessageToPanel extends Schema.Union(IframeReady, EscapeKey, BackgroundMessage.CopyToClipboard) {}
