#!/usr/bin/env python3
"""Free Arabic Shorts topic planner. Uses a local editorial catalogue; no paid APIs."""
from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

CATALOG: list[dict[str, Any]] = [
    {
        "id": "water-cycle", "category": "science", "title": "رحلة قطرة ماء: كيف تعود الأمطار إلى الأرض؟",
        "hook": "هل تعلم أن قطرة الماء التي تشربها قد تكون سافرت عبر السماء آلاف المرات؟",
        "keyword": "دورة الماء في الطبيعة", "related": ["التبخر", "التكاثف", "الهطول", "الماء"],
        "scenes": [
            ("تبدأ الرحلة من البحار والأنهار، حيث تسخّن الشمس سطح الماء.", "ocean waves aerial sea coast", ["ocean waves", "sea surface"]),
            ("تتحول بعض قطرات الماء إلى بخار خفيف يصعد إلى الغلاف الجوي.", "water evaporation sunlight steam", ["steam rising", "water vapor"]),
            ("في طبقات الجو الأبرد يتكاثف البخار، فتتكون السحب.", "white cumulus clouds blue sky", ["clouds", "cloud formation"]),
            ("تتجمع قطرات الماء داخل السحب، ثم تسقط أمطارًا أو ثلوجًا.", "rain falling green landscape", ["rainfall", "rain"]),
            ("تعود المياه إلى الأنهار والبحار، وتبدأ دورة جديدة لا تتوقف.", "river flowing into sea delta", ["river delta", "river mouth"])
        ]
    },
    {
        "id": "octopus-brain", "category": "science", "title": "الأخطبوط: لماذا لديه أذرع ذكية بشكل مدهش؟",
        "hook": "تخيل أن جزءًا كبيرًا من قراراتك يمكن أن تتخذه أذرعك!",
        "keyword": "ذكاء الأخطبوط", "related": ["حياة الأخطبوط", "الحيوانات البحرية", "الدماغ"],
        "scenes": [
            ("الأخطبوط من أذكى الكائنات البحرية، ويستطيع حل مشكلات معقدة.", "octopus underwater close up", ["octopus sea animal"]),
            ("يمتلك ثمانية أذرع، وكل ذراع يحتوي على شبكة عصبية واسعة.", "octopus arms suckers underwater", ["octopus tentacles"]),
            ("تساعده الممصات على لمس الأشياء وتذوق بعض المواد الكيميائية.", "octopus sucker macro", ["octopus suction cups"]),
            ("يستطيع فتح بعض الأوعية والاختباء وتغيير لون جلده للتمويه.", "octopus camouflage coral reef", ["camouflaged octopus"]),
            ("هذا يجعله مثالًا مذهلًا على تنوع الذكاء في عالم الحيوان.", "octopus swimming coral reef", ["octopus swimming"])
        ]
    },
    {
        "id": "lightning", "category": "science", "title": "كيف تتكوّن صاعقة البرق؟",
        "hook": "في جزء من الثانية، يطلق البرق طاقة هائلة في السماء!",
        "keyword": "كيف يحدث البرق", "related": ["العواصف الرعدية", "الكهرباء", "الطقس"],
        "scenes": [
            ("داخل السحب الركامية تتحرك قطرات الماء وبلورات الجليد بعنف.", "dramatic cumulonimbus thunderstorm cloud", ["thunderstorm clouds"]),
            ("تؤدي التصادمات إلى فصل الشحنات الكهربائية داخل السحابة.", "storm clouds dark sky", ["storm cloud formation"]),
            ("عندما يصبح فرق الشحنة كبيرًا، يبدأ مسار كهربائي في الهواء.", "lightning bolt storm sky", ["lightning strike"]),
            ("تسخّن الصاعقة الهواء بسرعة كبيرة، فيتمدّد وينتج صوت الرعد.", "lightning thunderstorm night", ["thunderstorm lightning"]),
            ("لذلك نرى البرق أولًا، ثم نسمع الرعد لأن الضوء أسرع من الصوت.", "lightning over distant landscape", ["distant lightning"])
        ]
    },
    {
        "id": "phone-touchscreen", "category": "technology", "title": "كيف تعرف شاشة هاتفك مكان لمسة إصبعك؟",
        "hook": "الشاشة لا تشعر بإصبعك كما تشعر أنت… فكيف تحدد مكان اللمسة؟",
        "keyword": "كيف تعمل شاشة اللمس", "related": ["الشاشة capacitive", "الهاتف الذكي", "تقنية اللمس"],
        "scenes": [
            ("معظم الهواتف الحديثة تستخدم شاشة لمس سعوية، لا تعتمد على الضغط فقط.", "smartphone touchscreen macro finger", ["touchscreen smartphone"]),
            ("تحت الزجاج توجد طبقة شفافة تحمل شبكة دقيقة من الأقطاب.", "touchscreen display technology macro", ["capacitive touchscreen"]),
            ("عندما يقترب الإصبع تتغير السعة الكهربائية في نقطة محددة.", "finger touching phone screen close up", ["finger phone screen"]),
            ("يقيس المتحكم هذا التغير ويحسب إحداثيات اللمسة.", "smartphone circuit board close up", ["mobile phone circuit board"]),
            ("ثم يحوّل النظام اللمسة إلى أمر، مثل فتح تطبيق أو تحريك صورة.", "using smartphone apps hand", ["smartphone app use"])
        ]
    },
    {
        "id": "deep-ocean", "category": "science", "title": "ماذا يحدث في أعماق المحيط حيث لا يصل ضوء الشمس؟",
        "hook": "هناك عالم كامل تحت البحر يعيش في ظلام شبه دائم!",
        "keyword": "أعماق المحيط", "related": ["كائنات الأعماق", "البحر العميق", "الإضاءة الحيوية"],
        "scenes": [
            ("كلما نزلنا أعمق في المحيط، يقل ضوء الشمس تدريجيًا.", "deep ocean underwater blue light", ["deep sea ocean"]),
            ("في الأعماق السحيقة يصبح الظلام شبه كامل والضغط هائلًا.", "dark deep sea ocean", ["abyssal ocean"]),
            ("تعيش هناك كائنات تكيفت مع البرودة والضغط وقلة الغذاء.", "deep sea fish underwater", ["deep sea creatures"]),
            ("بعضها يصنع ضوءًا خاصًا بجسمه، في ظاهرة تسمى الإضاءة الحيوية.", "bioluminescent jellyfish deep sea", ["bioluminescence"]),
            ("ولا يزال العلماء يكتشفون أنواعًا جديدة في هذا العالم الغامض.", "deep sea exploration submersible", ["deep sea submersible"])
        ]
    },
    {
        "id": "solar-panels", "category": "technology", "title": "كيف تحوّل الألواح الشمسية ضوء الشمس إلى كهرباء؟",
        "hook": "ضوء الشمس يصل إلى سطح اللوح… وبعد لحظات يصبح كهرباء!",
        "keyword": "كيف تعمل الألواح الشمسية", "related": ["الطاقة الشمسية", "الخلايا الكهروضوئية", "الكهرباء"],
        "scenes": [
            ("تتكون الألواح الشمسية من خلايا مصنوعة غالبًا من السيليكون.", "solar panel photovoltaic cells close up", ["photovoltaic solar panel"]),
            ("عندما تسقط الفوتونات على الخلية، تنقل طاقة إلى الإلكترونات.", "sunlight shining on solar panels", ["solar panels sunlight"]),
            ("يساعد المجال الكهربائي داخل الخلية على توجيه حركة الشحنات.", "solar cell silicon wafer", ["silicon solar cell"]),
            ("تنتج الخلية تيارًا كهربائيًا مستمرًا يمكن جمعه من عدة خلايا.", "solar farm panels rows", ["solar farm"]),
            ("ويحوّل العاكس هذا التيار إلى كهرباء مناسبة للاستخدام المنزلي.", "home solar inverter installation", ["solar inverter home"])
        ]
    }
]

def main() -> int:
    parser = argparse.ArgumentParser(description="Choose a fresh Arabic Shorts topic and write a video spec.")
    parser.add_argument("--output", required=True, help="Destination JSON project spec.")
    parser.add_argument("--history", default="", help="Persistent plain-text topic history file (shared across runs).")
    parser.add_argument("--category", choices=["any", "science", "technology"], default="any")
    args = parser.parse_args()

    history_path = Path(args.history).expanduser() if args.history else Path(args.output).expanduser().parent / "topic-history.txt"
    used: dict[str, int] = {}
    history_lines: list[str] = ["# VYROX TOPIC HISTORY v1"]
    if history_path.is_file():
        raw_history = history_path.read_text(encoding="utf-8-sig")
        lines = [line.strip() for line in raw_history.splitlines() if line.strip()]
        if lines and lines[0] != "# VYROX TOPIC HISTORY v1":
            raise SystemExit(f"Unrecognized topic history format; refusing to overwrite: {history_path}")
        history_lines = lines or ["# VYROX TOPIC HISTORY v1"]
        for line in history_lines[1:]:
            parts = [part.strip() for part in line.split("|", 2)]
            if len(parts) != 3 or not parts[1]:
                raise SystemExit(f"Malformed topic history entry; refusing to select a possibly repeated topic: {line}")
            try:
                stamp = int(parts[0])
            except ValueError:
                stamp = 0
            used[parts[1]] = max(stamp, int(used.get(parts[1], 0)))

    pool = [item for item in CATALOG if args.category == "any" or item["category"] == args.category]
    pool = [item for item in pool if item["id"] not in used]
    if not pool:
        raise SystemExit("No unused topics remain in the local catalogue. Add genuinely new topics; history was preserved.")

    # Never reuse a previously recorded topic. Stable catalogue order is the tie-break.
    chosen = pool[0]
    now = datetime.now(timezone.utc).isoformat()
    stamp = int(datetime.now(timezone.utc).timestamp())

    spec = {
        "title": chosen["title"],
        "format": "shorts",
        "contentCategory": chosen["category"],
        "topicId": chosen["id"],
        "hook": chosen["hook"],
        "seo": {
            "primaryKeyword": chosen["keyword"],
            "relatedKeywords": chosen["related"],
            "youtubeTitle": f'{chosen["title"]} | معلومة في دقيقة #Shorts',
            "descriptionLead": chosen["hook"],
            "hashtags": ["#" + re.sub(r"[^\w]", "_", chosen["keyword"]).strip("_"), "#علوم", "#معلومات", "#Shorts", "#VYROX"],
            "tags": [chosen["keyword"], *chosen["related"], "VYROX", "Shorts"]
        },
        "editorial": {
            "selectionMethod": "least-recently-used local evergreen catalogue",
            "trendDataUsed": False,
            "note": "This is an editorial selection, not a live trend or search-volume measurement."
        },
        "scenes": [
            {"narration": narration, "search": search, "fallback_search": fallback}
            for narration, search, fallback in chosen["scenes"]
        ]
    }
    out = Path(args.output).expanduser()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(spec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    # Preserve an auditable human-readable concept file next to every generated spec.
    concept_stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    concept_path = out.with_name(f"{chosen['id']}-{concept_stamp}-concept.txt")
    concept_lines = [
        "VYROX VIDEO CONCEPT",
        f"Topic ID: {chosen['id']}",
        f"Title: {chosen['title']}",
        f"Category: {chosen['category']}",
        f"Created (UTC): {now}",
        "",
        "HOOK:",
        chosen["hook"],
        "",
        "SCENE PLAN:",
    ]
    for index, scene in enumerate(spec["scenes"], start=1):
        concept_lines.extend([
            f"{index}. Narration: {scene['narration']}",
            f"   Footage search: {scene['search']}",
            f"   Fallbacks: {', '.join(scene['fallback_search'])}",
        ])
    concept_lines.extend(["", "SEO KEYWORD:", chosen["keyword"], ""])
    concept_path.write_text("\n".join(concept_lines), encoding="utf-8")

    history_path.parent.mkdir(parents=True, exist_ok=True)
    history_lines.append(f"{stamp} | {chosen['id']} | {chosen['title']}")
    temp_history = history_path.with_suffix(history_path.suffix + ".tmp")
    temp_history.write_text("\n".join(history_lines) + "\n", encoding="utf-8")
    temp_history.replace(history_path)
    print(json.dumps({"selectedTopic": chosen["title"], "category": chosen["category"], "projectSpec": str(out), "conceptFile": str(concept_path), "historyFile": str(history_path), "trendDataUsed": False}, ensure_ascii=False))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
