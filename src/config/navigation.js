import {
  Activity,
  BarChart3,
  Bell,
  Box,
  CalendarClock,
  History,
  LayoutDashboard,
  ShoppingCart,
  Users,
} from "lucide-react";
import { ADMIN_ROLES, OPERATOR_ROLES, ROLES, STAFF_ROLES } from "./constants";

/**
 * Sidebar menu. `roles` decides who sees the link; App.jsx uses the same
 * role lists to protect the routes, so the two can't drift apart.
 * `roles: null` = everyone, including signed-out visitors.
 */
export const NAV_SECTIONS = [
  {
    title: "Overview",
    items: [
      { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard, roles: STAFF_ROLES },
      { label: "Alerts", path: "/notifications", icon: Bell, roles: STAFF_ROLES },
    ],
  },
  {
    title: "Operations",
    items: [
      { label: "Inventory", path: "/inventory", icon: Box, roles: OPERATOR_ROLES },
      { label: "Drying Control", path: "/scheduler", icon: CalendarClock, roles: OPERATOR_ROLES },
      { label: "Sensors", path: "/sensors", icon: Activity, roles: STAFF_ROLES },
    ],
  },
  {
    title: "Reports",
    items: [
      { label: "History", path: "/history", icon: History, roles: STAFF_ROLES },
      { label: "Analytics", path: "/analytics", icon: BarChart3, roles: STAFF_ROLES },
    ],
  },
  {
    title: "Sales",
    items: [{ label: "Shop", path: "/shop", icon: ShoppingCart, roles: null }],
  },
  {
    title: "Administration",
    items: [{ label: "Users", path: "/users", icon: Users, roles: ADMIN_ROLES }],
  },
];

/** Where each role lands after signing in. */
export function homePathFor(role) {
  if (STAFF_ROLES.includes(role)) return "/dashboard";
  if (role === ROLES.CUSTOMER) return "/shop";
  return "/shop";
}
