---
title: "Notion Blog 的心路历程(第一版)"
date: "2025-07-14"
slug: "notionblog"
tags: ["技术学习", "测试"]
---
### **前言**


你好，未来的博主！


这份指南将带你从零开始，搭建一个强大、全自动的个人博客系统。你只需要在舒适的 Notion 环境中写作，剩下的所有事情——从同步文章、构建网站到发布上线、清理缓存——都将由我们设置的自动化流程来完成。


我们经历了无数次的试错，最终总结出了这套最稳定、最可靠的方案。只要你严格按照这份指南的步骤操作，就能避开我们曾经踩过的所有“坑”，顺利地拥有一个属于你自己的、用 Notion 驱动的个人网站。


**我们将使用的核心技术栈：**

- **内容管理**: Notion
- **网站生成**: Hugo (以 Blowfish 主题为例)
- **代码托管与自动化**: GitHub & GitHub Actions
- **加速与域名解析**: Cloudflare (可选)

让我们开始吧！


### **第一部分：基础准备**


在开始之前，我们需要先准备好一个 Hugo 网站的“骨架”。


### **第 1 步：在本地搭建 Hugo 网站**

1. **安装 Hugo**: 如果你的电脑上还没有安装 Hugo，请参考 [Hugo 官方文档](https://gohugo.io/installation/) 进行安装。
2. **创建新网站**: 打开你的终端（命令行工具），运行以下命令：
3. **添加主题 (使用 Git Submodule)**: 这是最稳定可靠的方式。我们将以 Blowfish 主题为例。

	```text
	git submodule add -b main https://github.com/nunocoracao/blowfish.git themes/blowfish
	
	
	```

4. **基础配置**: 在你的网站根目录下，找到或创建 `hugo.toml` 文件（或者在 `config/_default/` 文件夹下），并写入最基础的配置。最关键的是要包含 `theme = "blowfish"` 这一行。

### **第 2 步：创建 GitHub 仓库并推送**

1. 在 GitHub 上创建一个全新的、**公开 (Public)** 的仓库。建议仓库名和你的 GitHub 用户名一致，例如 `your-username.github.io`。
2. 在你的本地终端里，将你的本地仓库与远程仓库关联，并进行第一次推送：

	```text
	git remote add origin https://github.com/your-username/your-repo-name.git
	git add .
	git commit -m "Initial Hugo site with Blowfish theme"
	git push -u origin main
	
	
	```


### **第二部分：配置 Notion (最关键的一步)**


Notion 是我们的写作平台，这里的每一步都至关重要。


### **第 1 步：创建 Notion 集成 (Integration)**

1. 访问 [https://www.notion.so/my-integrations](https://www.notion.so/my-integrations)。
2. 点击 **"+ New integration"**。
3. 给它起个名字（比如 "My Hugo Blog"），并关联到你的工作区。
4. **【关键】** 在 "Integration Type" 处，请务必保持默认的 **"Internal Integration" (内部集成)**。
5. 提交后，进入 "Secrets" 标签页，复制那段以 `secret_...` 开头的 **Internal Integration Token**。**这是你的第一把钥匙，请妥善保管。**

### **第 2 步：创建文章数据库**

1. 在 Notion 中创建一个新的**页面 (Page)**，然后选择 **"Table - Full page"** 来创建一个数据库。
2. 给数据库起个名字，比如 "My Blog Posts"。

### **第 3 步：【避坑指南】设置标准的数据库属性**


这是我们调试过程中遇到最多问题的环节。为了让自动化脚本能正确识别，请**严格按照**以下列表创建你的数据库列，确保**英文名、类型、大小写**完全一致。

undefined
**警告：** 任何不符合这个规范的列名（比如用中文，或者大小写错误）都可能导致自动化流程失败！


### **第 4 步：连接集成并获取数据库 ID**

1. 回到你刚创建的数据库页面，点击右上角的 `...` 菜单 -> `Add connections`。
2. 在列表中搜索并选择你第一步创建的那个集成 ("My Hugo Blog")，点击确认。**这一步是授权，必须操作！**
3. 现在，查看你浏览器的地址栏。URL 看起来像这样：

	https://www.notion.so/your-workspace/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx?v=...


	那个紧跟在工作区名字后面、问号前面的 32 位字符就是你的 Database ID。这是你的第二把钥匙，请复制并保存好它。


### **第三部分：配置 GitHub 自动化**


现在，我们来配置 GitHub Actions，让它成为我们的自动化管家。


### **第 1 步：添加仓库 Secrets**

1. 进入你的 GitHub 仓库页面，点击 `Settings` -> `Secrets and variables` -> `Actions`。
2. 点击 "New repository secret"，创建以下**两个** Secret：
	- **Name**: `NOTION_TOKEN`
		- **Value**: 粘贴你从 Notion 集成中获取的那个 `secret_...` Token。
	- **Name**: `NOTION_PAGE_URL` (我们沿用这个名字，但它的值是数据库ID)
		- **Value**: 粘贴你从 Notion 数据库 URL 中获取的那个 **32 位 ID**。

### **第 2 步：创建 GitHub Actions 工作流文件**

1. 在你的 GitHub 仓库页面，点击 `Add file` -> `Create new file`。
2. 在文件名的输入框里，输入 `.github/workflows/deploy.yml`。
3. 将我们最终成功的那份**“合并主题文件”**方案的代码，完整地粘贴进去。这份代码是我们所有经验的结晶，它最稳定、最可靠。

### **第四部分：网站上线与域名配置**


### **第 1 步：【避坑指南】配置 GitHub Pages**


这是另一个非常容易出错的地方！

1. 进入你的 GitHub 仓库页面，点击 `Settings` -> `Pages`。
2. 在 **"Build and deployment"** 这个区域，将 **Source** (源) 的下拉菜单从 "Deploy from a branch" 修改为 **"GitHub Actions"**。

### **第 2 步：(可选) 配置自定义域名和 Cloudflare**


如果你想使用自己的域名，可以参考我们之前的讨论，在 Cloudflare 上设置好 DNS 解析记录，然后在这里的 "Custom domain" 部分填入你的域名并保存。


### **第五部分：自动化缓存清理 (可选)**


如果你使用了 Cloudflare，强烈建议你配置这一步，实现真正的全自动更新。

1. 在 Cloudflare 创建一个**自定义 API 令牌**，权限只授予 `Zone` - `Cache Purge` - `Purge`。
2. 获取你的 **Zone ID**。
3. 在 GitHub Secrets 中，添加 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ZONE_ID`。
4. 在我们最终的工作流文件的 `deploy` 任务最后，加入清除缓存的步骤。

### **第六部分：开始写作！**


恭喜你！现在你拥有了一个完美的自动化博客系统。你的日常工作流程将非常简单：

1. 在 Notion 数据库里写新文章，或者修改旧文章。
2. 写完后，将文章的 `status` 设置为 `Published`。
3. 等待定时任务触发，或者去 Actions 页面手动运行一次。
4. 几分钟后，你的网站就会自动更新，并且 Cloudflare 的缓存也会被清空。

希望这份凝聚了我们共同努力和经验的指南，能帮助到更多的人！

