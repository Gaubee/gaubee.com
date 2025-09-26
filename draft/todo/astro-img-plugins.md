帮我寻找或者开发几个astro插件，来为我的博客提供良好的图片查看功能：

1. 插件1:首先我的图片在build的阶段，要能自动生成不同尺寸的图片，能根据不同屏幕的需求自动选择适合的图片。
2. 插件2:在build阶段中，为图片生成 blurhash，在图片加载阶段使用 `npm:fast-blurhash` 来做图片的占位。
3. 插件3:生成photoswipe信息，基于对于图片元数据的提取。并且在标记成`data-enable-photoswipe=true`属性的元素上可以自动初始化 photoswipe 对象，从而实现点击图片可以查看原图。
