import { useMemo, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Layout, Menu, Typography, Button } from 'antd';
import {
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ShoppingOutlined,
  UserOutlined,
  GlobalOutlined,
} from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';

const { Sider, Content } = Layout;

const menuItems = [
  { key: '/map', icon: <GlobalOutlined />, label: <Link to="/map">Bản đồ</Link> },
  {
    key: '/property-buys',
    icon: <ShoppingOutlined />,
    label: <Link to="/property-buys">Giao dịch mua</Link>,
  },
];

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const selectedKey = useMemo(() => {
    if (location.pathname.startsWith('/property-buys')) return '/property-buys';
    return '/map';
  }, [location.pathname]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <Layout className="app-layout">
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        trigger={null}
        width={240}
        className="app-sider"
      >
        <div className="app-brand">
          <GlobalOutlined className="app-brand-icon" />
          {!collapsed ? <span>HCM Land</span> : null}
        </div>

        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
        />

        <div className="app-sider-footer">
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed((value) => !value)}
            className="app-collapse-btn"
            aria-label={collapsed ? 'Mở rộng sidebar' : 'Thu gọn sidebar'}
          >
            {!collapsed ? 'Thu gọn' : null}
          </Button>
          {!collapsed ? (
            <Typography.Text type="secondary" className="app-user-email">
              <UserOutlined /> {user?.displayName || user?.email}
            </Typography.Text>
          ) : null}
          <Button
            type="text"
            icon={<LogoutOutlined />}
            onClick={() => void handleLogout()}
            className="app-logout-btn"
          >
            {!collapsed ? 'Đăng xuất' : null}
          </Button>
        </div>
      </Sider>

      <Layout>
        <Content className="app-content">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
