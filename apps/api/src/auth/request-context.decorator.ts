import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { RequestContext } from '@meshos/types';

export const ReqContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestContext => {
    const request = ctx.switchToHttp().getRequest<{ user: RequestContext }>();
    return request.user;
  },
);
