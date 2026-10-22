import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from '@tanstack/react-router'

import { RootLayout } from './root-layout'

const rootRoute = createRootRoute({
  component: RootLayout,
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: lazyRouteComponent(() => import('./pages'), 'HomePage'),
})

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app',
  component: lazyRouteComponent(() => import('./pages'), 'AppPage'),
})

const catalogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/catalog',
  component: lazyRouteComponent(() => import('./features/catalog'), 'CatalogPage'),
})

const pricingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/pricing',
  component: lazyRouteComponent(() => import('./features/pricing'), 'PricingPage'),
})

const routeTree = rootRoute.addChildren([indexRoute, appRoute, catalogRoute, pricingRoute])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
