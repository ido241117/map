import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { GlobalOutlined } from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';

export function RegisterPage() {
  const { register, user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (user) {
    return <Navigate to="/map" replace />;
  }

  const onFinish = async (values: {
    email: string;
    password: string;
    displayName?: string;
  }) => {
    setLoading(true);
    setError('');
    try {
      await register(values.email, values.password, values.displayName);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Đăng ký thất bại');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <Card className="auth-card">
        <div className="auth-brand">
          <GlobalOutlined />
          <Typography.Title level={3}>Tạo tài khoản</Typography.Title>
          <Typography.Paragraph type="secondary">Đăng ký để sử dụng HCM Land</Typography.Paragraph>
        </div>

        {error ? <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} /> : null}

        <Form layout="vertical" onFinish={onFinish} requiredMark={false}>
          <Form.Item label="Tên hiển thị" name="displayName">
            <Input placeholder="Nguyễn Văn A" autoComplete="name" />
          </Form.Item>

          <Form.Item
            label="Email"
            name="email"
            rules={[
              { required: true, message: 'Nhập email' },
              { type: 'email', message: 'Email không hợp lệ' },
            ]}
          >
            <Input placeholder="you@example.com" autoComplete="email" />
          </Form.Item>

          <Form.Item
            label="Mật khẩu"
            name="password"
            rules={[
              { required: true, message: 'Nhập mật khẩu' },
              { min: 6, message: 'Mật khẩu tối thiểu 6 ký tự' },
            ]}
          >
            <Input.Password placeholder="••••••" autoComplete="new-password" />
          </Form.Item>

          <Button type="primary" htmlType="submit" block loading={loading}>
            Đăng ký
          </Button>
        </Form>

        <Typography.Paragraph className="auth-switch">
          Đã có tài khoản? <Link to="/login">Đăng nhập</Link>
        </Typography.Paragraph>
      </Card>
    </div>
  );
}
