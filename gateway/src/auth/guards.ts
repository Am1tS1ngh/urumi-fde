import { createParamDecorator, ForbiddenException, Inject, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { bearerToken, type AuthedRequest, type AuthUser } from './auth.types.js';

/** Dashboard routes: requires a valid session token. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const token = bearerToken(req);
    const user = token ? await this.auth.userForSession(token) : null;
    if (!user) throw new UnauthorizedException('Please sign in.');
    req.user = user;
    return true;
  }
}

/** Use after SessionGuard. */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.switchToHttp().getRequest<AuthedRequest>().user?.role !== 'admin') throw new ForbiddenException('Admins only.');
    return true;
  }
}

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthUser => {
  const user = context.switchToHttp().getRequest<AuthedRequest>().user;
  if (!user) throw new UnauthorizedException();
  return user;
});
