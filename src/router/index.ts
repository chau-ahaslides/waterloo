// Vue Router setup.
//
// The app authenticates via a JWT in the URL (`?token=…`), read by
// getToken() from window.location.search. To keep that token working across
// navigation, a global guard re-attaches the current `token` query param to
// any route that navigates without one.

import {
  createRouter,
  createWebHistory,
  type RouteLocationNormalized,
} from 'vue-router'
import Home from '@/views/Home.vue'
import LessonPlay from '@/views/LessonPlay.vue'
import TakeLesson from '@/views/TakeLesson.vue'
import LessonReport from '@/views/LessonReport.vue'
import PresentationList from '@/views/PresentationList.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: Home },
    {
      path: '/presentations',
      name: 'presentations',
      component: PresentationList,
    },
    {
      path: '/lesson/:id/play',
      name: 'lesson-play',
      component: LessonPlay,
    },
    {
      // Real audience run — submits the attempt to the D1-backed API.
      path: '/lesson/:id/take',
      name: 'lesson-take',
      component: TakeLesson,
    },
    {
      // Per-lesson report of all audience attempts.
      path: '/lesson/:id/report',
      name: 'lesson-report',
      component: LessonReport,
    },
  ],
})

// Preserve the ?token= query param across navigations: if the user navigates
// somewhere without a token but the current URL has one, carry it forward.
router.beforeEach((to: RouteLocationNormalized) => {
  const currentToken = new URLSearchParams(window.location.search).get('token')
  if (currentToken && !to.query.token) {
    return { ...to, query: { ...to.query, token: currentToken } }
  }
  return true
})

export default router
