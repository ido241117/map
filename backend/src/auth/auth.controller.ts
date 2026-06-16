import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  register(
    @Body() body: { email: string; password: string; displayName?: string },
  ) {
    return this.authService.register(body);
  }

  @Public()
  @Post('login')
  login(@Body() body: { email: string; password: string }) {
    return this.authService.login(body);
  }

  @Post('logout')
  logout() {
    return { ok: true };
  }

  @Get('me')
  me(@Req() req: { user: { sub: number } }) {
    return this.authService.getProfile(req.user.sub);
  }
}
