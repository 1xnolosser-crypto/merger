# Merger — استوديو فيديو مجاني محليًا

المسار المعتمد لإنشاء الفيديوهات الآن هو **الاستوديو المحلي المجاني** الموجود في `scripts/free_video_studio.py`. لا يستخدم Agnes أو KIE أو أي API لتوليد الصور أو الفيديو، ولا يتطلب مفاتيح أو أرصدة أو اشتراكات.

## إنشاء فيديو مجاني على Windows

- **الصور:** Wikimedia Commons، مع قبول CC0 وPublic Domain وCC BY فقط وتسجيل الإسناد.
- **التعليق العربي:** Edge TTS عبر الإنترنت دون مفتاح API؛ يعتمد على توفر الخدمة وقد تتغير إتاحتها.
- **المونتاج والترجمة والحركة:** FFmpeg محليًا على جهاز Windows.
- **الإخراج:** MP4 بدقة 720p، أفقي أو Shorts عمودي. لا يتم رفع الفيديو تلقائيًا إلى أي خدمة.

افتح `examples/free-video-project.json` وعدّل نص المشاهد وكلمات البحث الإنجليزية، ثم نفّذ:

```powershell
.\scripts\run-free-video.ps1
```

دليل الإعداد الكامل: [docs/free-video-studio-ar.md](docs/free-video-studio-ar.md).

**مهم:** هذا المسار يصنع فيديو وثائقيًا من صور حقيقية مرخصة مع حركة وانتقالات وتعليق صوتي وترجمة. ليس نموذجًا لتوليد لقطات اصطناعية جديدة من النص.

## خادم MCP القديم

يظل خادم MCP موجودًا لأعمال إدارة المهام ودمج المقاطع. تم تعطيل أداتي `generate_image` و`generate_video` حتى لا ترسلا طلبات إلى مزود مدفوع أو Agnes. استخدم الاستوديو المحلي أعلاه لإنشاء فيديو جديد.

## المعمارية

تطبيق **Next.js 16** واحد فيه جزءان:

- **خادم MCP** على المسار `/mcp` (نقل Streamable HTTP حسب مواصفات MCP) يعرض **5 أدوات** يستدعيها نموذج الذكاء الاصطناعي من أي عميل (ChatGPT Connectors / Claude Desktop / Cursor / Windsurf / Cline / GPT Agents SDK).
- **واجهة ويب عربية RTL** على المسار `/` لإدارة مفاتيح API ومتابعة المهام حية وعرض إعدادات الربط جاهزة للنسخ.

قاعدة البيانات: **Turso (libsql)** عبر Prisma Client + `@prisma/adapter-libsql`.

خدمة WebSocket مصغّرة على المنفذ 3003 (`mini-services/ws-bus`) لبثّ تقدّم المهام حيًا.

## القواعد الجوهرية (مُطبَّقة في الكود)

- **لا يُنزَّل أي ملف وسائط على السيرفر** — نرسل الروابط للمزود ونخزّن روابط النتائج فقط في Turso. الملفات تبقى على بنية المزود أو خدمة الدمج.
- **سياسة التكلفة الصفرية:** تم تعطيل KIE والتبديل التلقائي بين المفاتيح؛ لا يُرسل أي طلب توليد مدفوع ولا يُسمح بالانتقال لمفتاح آخر عند فشل المزود. يلزم دمج مزود مجاني فعلي قبل تفعيل التوليد.
- **التوليد غير متزامن**: كل أداة تُعيد `task_id` فورًا، والعميل يستدعي `get_task` كل ~10 ثوانٍ حتى `status="succeeded"`.

## الأدوات الخمس

| الاسم | الوصف | المُخرجات |
| --- | --- | --- |
| `generate_image` | توليد صورة من نص | `{ task_id, status: "queued", progress: 0 }` |
| `generate_video` | توليد فيديو بصوت أصلي | `{ task_id, status: "queued", progress: 0 }` |
| `merge_videos` | دمج عدة روابط فيديو بالترتيب | `{ task_id, status: "queued", progress: 0 }` |
| `get_task` | استعلام عن مهمة | `{ task_id, status, progress, result_url?, error? }` |
| `list_recent_tasks` | آخر 20 مهمة | `{ tasks: [{ task_id, type, status, ... }] }` |

## الإعداد المحلي

```bash
# 1. انسخ متغيرات البيئة واملأها
cp .env.example .env

# 2. ثبّت الحزم
bun install

# 3. أنشئ الجداول على Turso (مباشرة عبر libsql، لا عبر prisma db push)
bun run scripts/init-turso.ts

# 4. شغّل السيرفر + خدمة WebSocket
bun run dev        # http://localhost:3000
# خدمة WS تُشغَّل تلقائيًا من .zscripts/dev.sh
```

## الإعداد في العملاء

كل عميل MCP يحتاج فقط رابط نقطة النهاية:

```
https://YOUR_DOMAIN/mcp
```

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "media-gen": { "url": "https://YOUR_DOMAIN/mcp" }
  }
}
```

### Cursor (`~/.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "media-gen": { "url": "https://YOUR_DOMAIN/mcp" }
  }
}
```

### Windsurf (`~/.codeium/windsurf/mcp_config.json`)

```json
{
  "mcpServers": {
    "media-gen": { "serverUrl": "https://YOUR_DOMAIN/mcp" }
  }
}
```

### Cline (`cline_mcp_settings.json`)

```json
{
  "mcpServers": {
    "media-gen": {
      "url": "https://YOUR_DOMAIN/mcp",
      "alwaysAllow": ["generate_image","generate_video","merge_videos","get_task","list_recent_tasks"]
    }
  }
}
```

### GPT Agents SDK (Python)

```python
from agents import Agent, Runner
from agents.mcp import MCPServerStreamableHttp

mcp = MCPServerStreamableHttp(params={"url": "https://YOUR_DOMAIN/mcp"})
agent = Agent(name="media-agent", instructions="...", mcp_servers=[mcp])
result = Runner.run_sync(agent, "ولّد صورة لمدينة ليلية بأمطار")
print(result.final_output)
```

### ChatGPT Connectors

في ChatGPT → Settings → Connectors → Add custom connector، الصق رابط `/mcp`.

## نقاط النهاية

| المسار | الطريقة | الوصف |
| --- | --- | --- |
| `/` | GET | الواجهة العربية (RTL) |
| `/mcp` | POST/GET/DELETE | نقطة MCP Streamable HTTP |
| `/api/keys` | GET/POST | إدارة مفاتيح API |
| `/api/keys/[id]` | PATCH/DELETE | تحديث/حذف مفتاح |
| `/api/tasks` | GET | قائمة المهام |
| `/api/tasks/[id]` | GET | تفاصيل مهمة |
| `/api/health` | GET | فحص صحة الخدمة |
| `ws://host/?XTransformPort=3003` | WebSocket | بثّ تقدّم المهام |

## مزودو التوليد وسياسة التكلفة

- **kie.ai:** معطّل عمدًا بموجب سياسة التكلفة الصفرية. لا يتم إرسال طلبات توليد إليه.
- **tmpfiles.org:** ما زال مستخدمًا لاستضافة ناتج الدمج؛ راجع شروطه واحتفظ بنسخة محلية من الملفات المهمة.
- لا يُسمح بتفعيل أي مزود مدفوع أو استهلاك رصيد تلقائيًا.

## التقنيات

- Next.js 16 + Turbopack + App Router
- TypeScript 5
- Tailwind CSS 4 + shadcn/ui (تخصيص دافئ بدل الأزرق/البنفسجي)
- Prisma 6 + `@prisma/adapter-libsql` (Turso)
- `@modelcontextprotocol/sdk` 1.32
- socket.io 4 + socket.io-client (خدمة مصغّرة على المنفذ 3003)
- ffmpeg 7 (لدمج المقاطع عبر `child_process`)
- zod 4 للتحقق من مُدخلات الأدوات

## ملاحظات

- الجداول تُنشأ عبر `scripts/init-turso.ts` (وليس `prisma db push`) لأن SQLite CLI لا يقبل روابط libsql. Prisma Client يستخدم محوّل libsql في runtime.
- خدمة الدمج تنزّل المقاطع إلى `/tmp` مؤقتًا، تدمجها عبر ffmpeg، ترفع النتيجة إلى tmpfiles.org، ثم تنظّف `/tmp`. هذا هو «خدمة الدمج» المسموح لها بمعالجة الملفات عابرةً.
- المهام المعلّقة (queued/running) لأكثر من 30 دقيقة تُسترجع تلقائيًا كـ failed بواسطة خدمة WS كل دقيقتين.
