现在的围绕admin的编辑页面要展开一系列的改进：

1. 使用 https://codemirror.net/ ，请用它来重构我们的编辑页面与Diff预览页面。
   - 使用 codemirror 而不是 Monaco Editor，目的是获得更好的移动端支持
   - 这是文档 https://context7.com/websites/codemirror_net/llms.txt
   1. 要考虑 mermaid 高亮的支持
   2. 有预览功能，参考astro.config中的插件配置来实现md2html，最终使用 @tailwindcss/typography 去做渲染，从而确保和正式上线的一致性。
   3. 要有同时目录导航的预览。
   4. 要能支持 prettier 格式化（我印象中 prettier 是可以在前端使用的）
   5. 要有工具栏，因为在移动端，编辑一些md符号并不方便。
   6. 要能有基本的 补全提示 的功能，特别是要有基础的关键字补全的支持

2. 要能支持 附件、图片的上传功能，因为我们已经有 000123.xxx.md 这样的文件名了，所以可以知道应该放在 assets/article-0123 或者 assets/event-00123 文件夹下。要能支持拖拽上传、支持粘贴图片、支持修改文件名称。

3. 优化元数据的编辑体验
   1. 元数据的编辑要符合类型规范，比如date/updated是日期类型，tags是Array
   2. updated字段要能自动更新，就是提交暂存的时候自动更新updated日期

4. admin的首页是一个“项目页”，会基于 `draft/{project-name}` 下的文件夹就是一个个项目，全名就是“草稿项目”。
   1. 项目是为“文章”提供一种深度的编辑体验。但是我们仍然可以直接提供“新建文章”和“新建时讯”的按钮来做快速的发表。
   2. 一个项目可以用来发表多个文章、时讯，但是这些文章会有一致的“中缀”，就是`{project-name}`。
   3. 项目默认根据文件夹的最后修改时间来排序，或者可以支持名字排序。
      > 我印象中，是可以通过`https://api.github.com/repos/Gaubee/gaubee.com/commits?path=draft/w3c-observable-vs-tc39-signals/`这个接口来获得某个文件夹或者某个文件的最后提交的时间。
   4. 创建项目，就是创建一个 `draft/{project-name}` 下的文件夹，因此的名称不可以和 `draft/{project-name}` 下的冲突，如果冲突，就提示是不是要打开已经存在的项目
   5. 因为我们的“草稿项目”其实是一个文件夹，因此可以编辑页面中，要有一个文件列表栏。我们可以在这个项目中存放多个文件。如果我在md中上传图片、上传文件，那么这些图片文件都会被存放到这个草稿文件夹中。
   6. 所有文本文件都可以打开编辑或者修改、保存。如果是视频文件和图片文件或者pdf等非文本的文件，就不支持修改功能，只有基础的删除、替换的功能。
   7. 如果是md文件，那么会额外提供一个“发表”的功能按钮，那么会出现一个确认发布的弹窗：
      1. 一旦确认，首先会生成 `draft/{project-name}/{article,event}-{nid}[.{suffix}].md` 这样的文件，然后同时会创建资源文件夹`public/assets/{article,event}-{nid}/`来存放引用的文件，最后创建`src/content/{articles,events}/{nid}.{project-name}[.{suffix}].md`文件。
      1. 如果文件名本身已经是 `{article,event}-{nid}[.{suffix}].md` 这样的名字形式，那么就没有“发表”的按钮，而是“更新”的按钮。更新是不用弹出“发表确认弹窗”的，而是直接写入到对应的文件了。前提是能找到对应的文件才能更新成功，否则需要弹出警告说文件不存在，需要用户二次确认才能去写入不存在的文件。
         1. 不论是更新或者创建`public/assets/{article,event}-{nid}/`下的文件是一定不能有残留的没有被使用的资源文件。
      1. `{nid}`是自动生成的id序号，不可重复。需要去到当前的`src/content/{articles,events}`中获取最后一页的数据，取到最后一条数据的id，然后+1，作为新的id序号。
         > 这里要注意，article的id长度至少是4位，event的id长度至少是5位，位数不够要向前补`0`
      1. 是发表的时候，确认弹窗中会有一个“发布类型”选择器和“后缀内容”输入框：
         1. 发布类型就是决定着`{article,event}`
         2. 后缀内容是可选的，如果不填，最终发布出来的就是`{nid}.{project-name}.md`这样的文件名，填写了就是`{nid}.{project-name}.{suffix}.md`这样的文件名
      1. 注意：`draft/{project-name}/{article,event}-{nid}[.{suffix}].md` 文件和 `src/content/{articles,events}/{nid}.{project-name}[.{suffix}].md` 的文件内容是不完全一样的，主要是在于文件的链接上：
         1. draft 文件夹下的链接是相对路径。链接到当前`{project-name}`的目录下。并且使用真实的文件名。
         2. 正式发布后，articles 文件夹下的链接是绝对路径到`public/assets/{article,event}-{nid}/`这个目录下。文件名使用hash，原本的文件名会被用作alt信息（如果没有alt信息的话）。
         3. 这种设计的目的有两点：
            1. 隔离。确保草稿项目的文件永远不会影响到正式发布的文章或者时讯
            2. 可逆。我们可以根据文件的 hash（github-api原生支持）来找出原本的存在于 draft 的文件夹的文件，如果有，就可以做逆向转换。
            - 注意！！：为什么需要“可逆”的支持呢，因为我们在打开`draft/{project-name}/{article,event}-{nid}[.{suffix}].md`文件的时候，同时要检查一下`src/content/{articles,events}/{nid}.{project-name}[.{suffix}].md`文件，如果存在后者的文件。那么就会有一个“恢复”按钮：
              1. 恢复功能就是将`src/content/{articles,events}/{nid}.{project-name}[.{suffix}].md`和`public/assets/{article,event}-{nid}/`目录下的文件逆向转化成`draft/{project-name}/{article,event}-{nid}[.{suffix}].md`和`draft/{project-name}/`下的文件（同时引用链接也会做相应的转化）。
              2. 我们在发现存在`src/content/{articles,events}/{nid}.{project-name}[.{suffix}].md`文件后，说明恢复功能可用，这时候还需要检查一下修改时间。如果后者的修改时间是更加的新，说明用户没有来“草稿项目”中修改文件，而是直接在发布的文章基础上做了修改。所以此时我们需要主动直接提示用户是否要进行文件恢复。
            - 因为可逆，所以如果我们打开一个`src/content/{articles,events}/{nid}.{project-name}[.{suffix}].md`文件要编辑的时候，如果能逆向找到草稿文件夹，那么编辑界面就会亮起一个按钮：“打开草稿项目”。如果找不到，那么应该亮起另一个按钮：“创建草稿项目”。
