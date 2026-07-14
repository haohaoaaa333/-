const isH5 = process.env.TARO_ENV === 'h5';
const tabIcon = (iconPath: string, selectedIconPath: string) => isH5 ? {} : { iconPath, selectedIconPath };

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
  subPackages: [
    {
      root: 'packageEssay',
      name: 'essay',
      pages: [
        'pages/list/index',
        'pages/reader/index',
        'pages/answer/index',
      ],
    },
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#020617',
    navigationBarTitleText: '',
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
        ...tabIcon('assets/tabbar/home.png', 'assets/tabbar/home_active.png'),
      },
      {
        pagePath: 'pages/study/index',
        text: '学习',
        ...tabIcon('assets/tabbar/book.png', 'assets/tabbar/book_active.png'),
      },
      {
        pagePath: 'pages/profile/index',
        text: '我的',
        ...tabIcon('assets/tabbar/profile.png', 'assets/tabbar/profile_active.png'),
      },
    ],
  },
});
