/// <reference types="@tarojs/taro" />

declare module '*.png';
declare module '*.gif';
declare module '*.jpg';
declare module '*.jpeg';
declare module '*.svg';
declare module '*.css';
declare module '*.scss';
declare module '*.sass';
declare module '*.less';
declare module '*.styl';

declare namespace NodeJS {
  interface ProcessEnv {
    TARO_ENV: 'weapp' | 'h5' | 'tt' | 'qq' | 'jd';
  }
}

// Taro page config types
declare function definePageConfig(config: Record<string, unknown>): Record<string, unknown>;
declare function defineAppConfig(config: Record<string, unknown>): Record<string, unknown>;
