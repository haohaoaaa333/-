export default defineAppConfig({
  lazyCodeLoading: 'requiredComponents',
  pages: [
    'pages/home/index',
    'pages/study/index',
    'pages/history/index',
    'pages/papers/index',
    'pages/practice/index',
    'pages/profile/index',
    'pages/privacy/index',
    'pages/terms/index',
    'pages/bookPacks/index',
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#020617',
    navigationBarTitleText: '考公宝',
    navigationBarTextStyle: 'white',
    backgroundColor: '#020617',
  },
  tabBar: {
    color: '#94a3b8',
    selectedColor: '#1a56db',
    borderStyle: 'black',
    backgroundColor: '#0f172a',
    list: [
      {
        pagePath: 'pages/home/index',
        text: '首页',
        iconPath: 'assets/tabbar/home.png',
        selectedIconPath: 'assets/tabbar/home_active.png',
      },
      {
        pagePath: 'pages/study/index',
        text: '学习',
        iconPath: 'assets/tabbar/book.png',
        selectedIconPath: 'assets/tabbar/book_active.png',
      },
      {
        pagePath: 'pages/profile/index',
        text: '我的',
        iconPath: 'assets/tabbar/profile.png',
        selectedIconPath: 'assets/tabbar/profile_active.png',
      },
    ],
  },
});
