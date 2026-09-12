import { BadRequestException, Controller, Headers, Logger, Post, Req } from '@nestjs/common';
import { validateSignature } from '@line/bot-sdk';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { LineService } from './line.service';
import { LineWebhookBody } from './line.types';

type RawBodyRequest = Request & { body: Buffer };

@Controller('line')
export class LineController {
  private readonly logger = new Logger(LineController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly lineService: LineService,
  ) {}

  @Post('webhook')
  async webhook(@Req() request: RawBodyRequest, @Headers('x-line-signature') signature?: string) {
    const channelSecret = this.config.get<string>('LINE_CHANNEL_SECRET');
    if (!channelSecret) {
      throw new BadRequestException('LINE_CHANNEL_SECRET is not configured');
    }

    if (!signature || !validateSignature(request.body, channelSecret, signature)) {
      throw new BadRequestException('Invalid LINE signature');
    }

    const body = JSON.parse(request.body.toString('utf8')) as LineWebhookBody;
    this.logger.log(`Accepted LINE webhook with ${body.events?.length ?? 0} event(s)`);
    await this.lineService.handleWebhook(body);
    return { ok: true };
  }
}
