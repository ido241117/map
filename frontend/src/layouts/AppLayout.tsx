import { memo, useCallback, useState } from 'react';
import { NavLink, Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ShoppingOutlined,
  GlobalOutlined,
} from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';
import { MapPage } from '../pages/MapPage';
import { PropertyBuyRecordsPage } from '../pages/PropertyBuyRecordsPage';

const navItems = [
  { to: '/map', icon: GlobalOutlined, label: 'Bản đồ' },
  { to: '/property-buys', icon: ShoppingOutlined, label: 'Giao dịch' },
] as const;

const PersistentMapPage = memo(MapPage);
const PersistentPropertyBuysPage = memo(PropertyBuyRecordsPage);

function AppSidebar() {
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();
  const { logout } = useAuth();

  const handleLogout = useCallback(async () => {
    await logout();
    navigate('/login');
  }, [logout, navigate]);

  return (
    <aside className={`app-nav app-nav--desktop${expanded ? ' is-expanded' : ''}`}>
      <div className="app-nav-brand">
        <GlobalOutlined className="app-nav-brand-icon" aria-hidden />
        <span className="app-nav-brand-title">HCM Land</span>
      </div>

      <nav className="app-nav-items" aria-label="Điều hướng chính">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => `app-nav-item${isActive ? ' is-active' : ''}`}
            title={label}
          >
            <Icon className="app-nav-item-icon" aria-hidden />
            <span className="app-nav-item-label">{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="app-nav-footer">
        <button
          type="button"
          className="app-nav-item"
          onClick={() => setExpanded((value) => !value)}
          aria-label={expanded ? 'Thu gọn sidebar' : 'Mở rộng sidebar'}
          title={expanded ? 'Thu gọn' : 'Mở rộng'}
        >
          {expanded ? (
            <MenuFoldOutlined className="app-nav-item-icon" aria-hidden />
          ) : (
            <MenuUnfoldOutlined className="app-nav-item-icon" aria-hidden />
          )}
          <span className="app-nav-item-label">{expanded ? 'Thu gọn' : 'Mở rộng'}</span>
        </button>
        <button
          type="button"
          className="app-nav-item"
          onClick={() => void handleLogout()}
          aria-label="Đăng xuất"
          title="Đăng xuất"
        >
          <LogoutOutlined className="app-nav-item-icon" aria-hidden />
          <span className="app-nav-item-label">Đăng xuất</span>
        </button>
      </div>
    </aside>
  );
}

function AppBottomNav() {
  const navigate = useNavigate();
  const { logout } = useAuth();

  const handleLogout = useCallback(async () => {
    await logout();
    navigate('/login');
  }, [logout, navigate]);

  return (
    <nav className="app-bottom-nav" aria-label="Điều hướng chính">
      {navItems.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) => `app-bottom-nav-item${isActive ? ' is-active' : ''}`}
        >
          <Icon className="app-bottom-nav-icon" aria-hidden />
          <span className="app-bottom-nav-label">{label}</span>
        </NavLink>
      ))}
      <button
        type="button"
        className="app-bottom-nav-item"
        onClick={() => void handleLogout()}
        aria-label="Đăng xuất"
      >
        <LogoutOutlined className="app-bottom-nav-icon" aria-hidden />
        <span className="app-bottom-nav-label">Thoát</span>
      </button>
    </nav>
  );
}

export function AppLayout() {
  const location = useLocation();
  const path = location.pathname;

  if (path === '/' || path === '') {
    return <Navigate to="/map" replace />;
  }

  if (path !== '/map' && !path.startsWith('/property-buys')) {
    return <Navigate to="/map" replace />;
  }

  const activeView = path.startsWith('/property-buys') ? 'property-buys' : 'map';

  return (
    <div className="app-shell">
      <AppSidebar />
      <main className="app-main">
        <div className={`app-view${activeView === 'map' ? ' is-active' : ''}`} aria-hidden={activeView !== 'map'}>
          <PersistentMapPage />
        </div>
        <div
          className={`app-view${activeView === 'property-buys' ? ' is-active' : ''}`}
          aria-hidden={activeView !== 'property-buys'}
        >
          <PersistentPropertyBuysPage />
        </div>
      </main>
      <AppBottomNav />
    </div>
  );
}
