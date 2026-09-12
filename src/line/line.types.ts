export type LineSource =
  | { type: 'user'; userId: string }
  | { type: 'group'; groupId: string; userId?: string }
  | { type: 'room'; roomId: string; userId?: string };

export interface LineWebhookBody {
  events?: LineWebhookEvent[];
}

export interface LineMessageEvent {
  type: 'message';
  replyToken: string;
  source: LineSource;
  message: {
    type: 'text';
    id: string;
    text: string;
    mention?: {
      mentionees?: Array<{
        index: number;
        length: number;
        userId?: string;
        isSelf?: boolean;
      }>;
    };
  };
}

export interface LinePostbackEvent {
  type: 'postback';
  replyToken: string;
  source: LineSource;
  postback: {
    data: string;
  };
}

export type LineWebhookEvent = LineMessageEvent | LinePostbackEvent | { type: string; [key: string]: unknown };
