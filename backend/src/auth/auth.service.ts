import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { DatabaseService } from '../shared/database.service';

type UserRow = {
  id: number;
  email: string;
  password_hash: string;
  display_name: string | null;
  created_at: Date;
};

export type AuthUser = {
  id: number;
  email: string;
  displayName: string | null;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwtService: JwtService,
  ) {}

  private toAuthUser(row: UserRow): AuthUser {
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
    };
  }

  private signToken(user: AuthUser) {
    return this.jwtService.sign({
      sub: user.id,
      email: user.email,
      displayName: user.displayName,
    });
  }

  async register(input: {
    email: string;
    password: string;
    displayName?: string;
  }) {
    const email = input.email.trim().toLowerCase();
    const password = input.password;
    const displayName = input.displayName?.trim() || null;

    if (!email || !password) {
      throw new ConflictException('Email và mật khẩu là bắt buộc');
    }
    if (password.length < 6) {
      throw new ConflictException('Mật khẩu phải có ít nhất 6 ký tự');
    }

    const existing = await this.db.query<UserRow>(
      'SELECT id FROM users WHERE email = $1',
      [email],
    );
    if (existing.rows.length) {
      throw new ConflictException('Email đã được sử dụng');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await this.db.query<UserRow>(
      `INSERT INTO users (email, password_hash, display_name)
       VALUES ($1, $2, $3)
       RETURNING id, email, password_hash, display_name, created_at`,
      [email, passwordHash, displayName],
    );

    const user = this.toAuthUser(result.rows[0]);
    return { token: this.signToken(user), user };
  }

  async login(input: { email: string; password: string }) {
    const email = input.email.trim().toLowerCase();
    const password = input.password;

    const result = await this.db.query<UserRow>(
      'SELECT id, email, password_hash, display_name, created_at FROM users WHERE email = $1',
      [email],
    );
    const row = result.rows[0];
    if (!row) {
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    }

    const valid = await bcrypt.compare(password, row.password_hash);
    if (!valid) {
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    }

    const user = this.toAuthUser(row);
    return { token: this.signToken(user), user };
  }

  async getProfile(userId: number): Promise<AuthUser> {
    const result = await this.db.query<UserRow>(
      'SELECT id, email, password_hash, display_name, created_at FROM users WHERE id = $1',
      [userId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new UnauthorizedException('Người dùng không tồn tại');
    }
    return this.toAuthUser(row);
  }
}
