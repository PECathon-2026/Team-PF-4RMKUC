from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
from pptx.dml.color import RGBColor
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'Mystic-Mikado-Presentation.pptx'
ART=ROOT/'dragon-art-presentation.png'
if not ART.exists():
    from PIL import Image
    source=Image.open(ROOT/'dragon-art.webp').convert('RGB')
    target_ratio=16/9
    sw,sh=source.size
    if sw/sh < target_ratio:
        nw=1600; nh=round(sh*nw/sw); source=source.resize((nw,nh))
        top=(nh-900)//2; source=source.crop((0,top,nw,top+900))
    else:
        nh=900; nw=round(sw*nh/sh); source=source.resize((nw,nh))
        left=(nw-1600)//2; source=source.crop((left,0,left+1600,900))
    source.save(ART,optimize=True)
prs=Presentation()
prs.slide_width=Inches(13.333)
prs.slide_height=Inches(7.5)
blank=prs.slide_layouts[6]
BG=RGBColor(12,12,16); PANEL=RGBColor(23,19,21); RED=RGBColor(227,74,63); GOLD=RGBColor(214,173,112)
PAPER=RGBColor(244,234,219); MUTED=RGBColor(175,163,152); GREEN=RGBColor(141,202,147); BLUE=RGBColor(146,184,218)

def set_bg(slide,color=BG):
    slide.background.fill.solid(); slide.background.fill.fore_color.rgb=color

def rect(slide,x,y,w,h,fill=PANEL,line=None,trans=0,rounded=True):
    shape=slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE if rounded else MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    shape.fill.solid(); shape.fill.fore_color.rgb=fill; shape.fill.transparency=trans
    shape.line.color.rgb=line or fill
    if rounded:
        try: shape.adjustments[0]=0.12
        except: pass
    return shape

def text(slide,content,x,y,w,h,size=18,color=PAPER,bold=False,font='Aptos',align=None,italic=False,margin=0.05):
    box=slide.shapes.add_textbox(Inches(x),Inches(y),Inches(w),Inches(h))
    tf=box.text_frame;tf.clear();tf.word_wrap=True
    tf.margin_left=Inches(margin);tf.margin_right=Inches(margin);tf.margin_top=Inches(margin);tf.margin_bottom=Inches(margin)
    p=tf.paragraphs[0];p.text=content;p.font.name=font;p.font.size=Pt(size);p.font.bold=bold;p.font.italic=italic;p.font.color.rgb=color
    if align is not None:p.alignment=align
    return box

def base_slide(kicker,title,subtitle=None):
    slide=prs.slides.add_slide(blank);set_bg(slide)
    # Small brand rail, not a visual template change from the web app.
    rect(slide,.42,.38,.08,.52,RED,RED,rounded=False)
    text(slide,kicker.upper(),.65,.38,5,.3,10,GOLD,True,font='Aptos')
    text(slide,title,.65,.85,11.8,.62,29,PAPER,True,font='Georgia')
    if subtitle:text(slide,subtitle,.68,1.52,11.9,.5,13,MUTED,font='Aptos')
    text(slide,'御門  MYSTIC MIKADO',.65,7.08,4,.2,9,GOLD,True)
    text(slide,f'{len(prs.slides):02d}',12.15,7.06,.5,.22,9,MUTED,align=PP_ALIGN.RIGHT)
    return slide

def bullet_card(slide,x,y,w,h,heading,items,accent=GOLD):
    rect(slide,x,y,w,h,PANEL,RGBColor(61,47,39),rounded=True)
    rect(slide,x,y,.05,h,accent,accent,rounded=False)
    text(slide,heading,x+.25,y+.18,w-.5,.35,15,accent,True)
    yy=y+.68
    for item in items:
        text(slide,'•',x+.28,yy,.2,.3,14,accent,True)
        text(slide,item,x+.52,yy,w-.78,.62,12.5,PAPER,font='Aptos')
        yy+=.75

# Slide 1 — cover
s=prs.slides.add_slide(blank);set_bg(s)
# Artwork panel on right, with dark veil on left side.
s.shapes.add_picture(str(ART), Inches(7.05), Inches(0), width=Inches(6.28), height=Inches(7.5))
rect(s,0,0,8.2,7.5,BG,BG,trans=9,rounded=False)
rect(s,.62,.78,.08,.76,RED,RED,rounded=False)
text(s,'御門',.95,.68,3.2,.7,35,RED,True,font='Georgia')
text(s,'MYSTIC MIKADO',.98,1.48,5.2,.35,15,GOLD,True)
text(s,'A quieter web.\nOne blog at a time.',.95,2.25,6.2,1.65,31,PAPER,True,font='Georgia')
text(s,'Offline-first RSS & Atom reader\nwith opt-in anonymous discovery',.98,4.1,5.6,.75,17,MUTED)
rect(s,.98,5.3,3.3,.48,RGBColor(48,22,22),RGBColor(110,42,36))
text(s,'FOLLOW DIRECTLY · READ OFFLINE',1.12,5.39,3.05,.25,10,GOLD,True,align=PP_ALIGN.CENTER)
text(s,'Project presentation · full-stack web application',.98,6.45,5.5,.3,11,MUTED)

# Slide 2 — problem and approach
s=base_slide('01 · Why RSS','Discovery without an algorithm','Readers already know how to follow blogs; the hard part is finding the next good one.')
bullet_card(s,.7,2.25,3.85,3.85,'THE PROBLEM',[
 'Algorithmic feeds rank what appears and can mix ads or tracking into the reading experience.',
 'RSS/Atom gives people direct subscriptions, but assumes they already know the URLs.',
 'A normal timeline should not become another ranking algorithm.'
],RED)
bullet_card(s,4.75,2.25,3.85,3.85,'THE IDEA',[
 'Keep the timeline chronological and subscriber-controlled.',
 'Use anonymized co-subscription overlap to suggest feeds followed alongside similar subscriptions.',
 'Show why each blog was suggested and exclude feeds already followed.'
],GOLD)
bullet_card(s,8.8,2.25,3.85,3.85,'THE RESULT',[
 'Follow blogs directly; read extracted articles online or offline.',
 'Discover is a separate page, never an injected timeline ranking.',
 'No account, stable reader ID, or stored submission history.'
],GREEN)

# Slide 3 — architecture
s=base_slide('02 · Architecture','Two layers, clear responsibilities','Browser-owned reading data; server-owned raw fetch and aggregate discovery only.')
# Client enclosure
rect(s,.7,2.05,6.05,4.45,RGBColor(17,18,23),RGBColor(69,55,44))
text(s,'CLIENT · YOUR BROWSER',.95,2.28,4.7,.3,12,GOLD,True)
for x,y,w,h,label,sub,accent in [
    (.95,2.85,2.45,.95,'Feed discovery','alternate links + common paths',RED),
    (3.72,2.85,2.45,.95,'RSS / Atom parser','XML parsed on-device',GOLD),
    (.95,4.08,2.45,.95,'Article extractor','semantic / text-density heuristic',GOLD),
    (3.72,4.08,2.45,.95,'Strict sanitizer','allowlisted HTML only',RED),
    (2.2,5.36,2.85,.78,'IndexedDB + service worker','posts, article cache, read/star state',GREEN)]:
    rect(s,x,y,w,h,PANEL,RGBColor(61,47,39))
    text(s,label,x+.12,y+.12,w-.24,.25,12,accent,True,align=PP_ALIGN.CENTER)
    text(s,sub,x+.12,y+.43,w-.24,.35,9.5,MUTED,align=PP_ALIGN.CENTER)
# Server enclosure
rect(s,7.1,2.05,5.55,4.45,RGBColor(17,18,23),RGBColor(69,55,44))
text(s,'SERVER · VERCEL FUNCTIONS',7.38,2.28,4.7,.3,12,GOLD,True)
rect(s,7.45,2.9,2.1,1.05,PANEL,RGBColor(61,47,39));text(s,'/api/fetch',7.55,3.08,1.9,.25,13,RED,True,align=PP_ALIGN.CENTER);text(s,'Raw bytes only\nSSRF checks · limits',7.6,3.42,1.8,.42,10,MUTED,align=PP_ALIGN.CENTER)
rect(s,9.85,2.9,2.35,1.05,PANEL,RGBColor(61,47,39));text(s,'Discovery APIs',9.98,3.08,2.05,.25,13,GOLD,True,align=PP_ALIGN.CENTER);text(s,'One-time token · batch\nrecommendations · popular',9.98,3.42,2.05,.42,9.5,MUTED,align=PP_ALIGN.CENTER)
rect(s,8.35,4.55,3.0,1.05,RGBColor(35,25,23),RGBColor(130,78,47));text(s,'Supabase Postgres',8.52,4.75,2.65,.28,13,PAPER,True,align=PP_ALIGN.CENTER);text(s,'Feed counts + co-subscription pairs\nshort-lived hashed rate-limit data',8.55,5.12,2.6,.42,9.5,MUTED,align=PP_ALIGN.CENTER)
text(s,'Browser parses and caches content. The server never stores feed bodies or extracted articles.',.9,6.68,11.5,.25,11,MUTED,italic=True)

# Slide 4 — client features
s=base_slide('03 · Reader flow','Follow. Read. Keep it offline.','Resilient per-feed errors keep the rest of the timeline usable.')
# left pipeline
steps=[('01','Enter a URL','Feed URL or blog homepage'),('02','Autodiscover','alternate links → common paths'),('03','Parse & merge','RSS / Atom into one timeline'),('04','Read full text','Extract in browser; sanitize before render'),('05','Save locally','IndexedDB + app-shell service worker')]
y=2.25
for n,head,desc in steps:
    rect(s,.85,y,.62,.55,RGBColor(48,22,22),RGBColor(110,42,36))
    text(s,n,.94,y+.12,.42,.22,11,GOLD,True,align=PP_ALIGN.CENTER)
    text(s,head,1.7,y-.02,2.5,.28,14,PAPER,True)
    text(s,desc,4.2,y-.02,4.2,.34,11,MUTED)
    if n!='05':rect(s,1.12,y+.59,.025,.3,RGBColor(98,69,49),RGBColor(98,69,49),rounded=False)
    y+=.82
# right callout
rect(s,8.65,2.25,3.9,3.95,RGBColor(22,19,21),RGBColor(88,62,45))
text(s,'RESILIENCE CHECKS',8.95,2.56,3.2,.3,13,GOLD,True)
checks=[('Dead / slow feed','Keep cached posts; show a per-feed error.'),('Malformed XML','Catch the parser error without breaking other feeds.'),('Full-text failure','Fall back to the feed’s own summary.'),('Offline reopen','Previously cached article, read/star state and timeline persist.')]
y=3.07
for head,desc in checks:
    text(s,'✓',8.98,y,.25,.25,14,GREEN,True)
    text(s,head,9.33,y,2.8,.25,11.5,PAPER,True)
    text(s,desc,9.33,y+.28,2.8,.5,10,MUTED)
    y+=.75
text(s,'Also includes: OPML import/export · ETag / Last-Modified · simplified robots.txt respect.',.9,6.74,11.8,.28,11,MUTED)

# Slide 5 — privacy and server security
s=base_slide('04 · Anonymous discovery','Only share what you choose','A batch updates aggregate counts; no reader identity is created.')
# flow tiles
flow=[('1','Opt in','Checkbox + explicit Share click'),('2','Get token','HMAC-signed · expires in 90 seconds'),('3','Validate batch','HTTP(S) only · ≤ 100 URLs · public IP DNS'),('4','Aggregate','Feed popularity + co-subscription pairs')]
positions=[(.75,2.35),(3.85,2.35),(6.95,2.35),(10.05,2.35)]
for (num,head,desc),(x,y) in zip(flow,positions):
    rect(s,x,y,2.5,1.38,PANEL,RGBColor(82,61,45))
    text(s,num,x+.18,y+.15,.3,.3,13,RED,True)
    text(s,head,x+.55,y+.15,1.75,.3,13,GOLD,True)
    text(s,desc,x+.18,y+.62,2.15,.52,10.5,MUTED,align=PP_ALIGN.CENTER)
for x in [3.35,6.45,9.55]:text(s,'→',x,2.82,.35,.35,22,RED,True,align=PP_ALIGN.CENTER)
# stored / not stored
rect(s,.8,4.35,5.75,1.8,RGBColor(17,24,19),RGBColor(65,104,69))
text(s,'STORED',1.1,4.65,1.3,.3,13,GREEN,True)
text(s,'Canonical feed URLs · aggregate submission counts · co-subscription pair counts · token nonce hashes until expiry · salted IP hashes expiring in 24 hours',1.1,5.08,5.1,.82,11,PAPER)
rect(s,6.8,4.35,5.75,1.8,RGBColor(32,19,19),RGBColor(119,55,48))
text(s,'NEVER STORED',7.1,4.65,2.0,.3,13,RED,True)
text(s,'Accounts · persistent reader IDs · raw IPs in SQL · per-batch history · article bodies · read/star state · browsing history',7.1,5.08,5.1,.82,11,PAPER)
text(s,'Limit acknowledged: aggregate counts represent anonymous opt-in batches, not verified distinct people.',.9,6.62,11.8,.28,11,MUTED,italic=True)

# Slide 6 — deployment and demo
s=prs.slides.add_slide(blank);set_bg(s)
s.shapes.add_picture(str(ART), Inches(8.0), Inches(0), width=Inches(5.333), height=Inches(7.5))
rect(s,0,0,8.8,7.5,BG,BG,trans=5,rounded=False)
rect(s,.65,.72,.08,.62,RED,RED,rounded=False)
text(s,'05 · DEMO & DEPLOYMENT',.9,.74,4,.24,10,GOLD,True)
text(s,'Ready to run.\nReady to test.',.9,1.28,6.4,1.15,31,PAPER,True,font='Georgia')
items=[
 ('LOCAL','Node 20+ · `npm run dev` · `npm test`'),
 ('DATABASE','Run `sql/schema.sql` in Supabase; set four server secrets.'),
 ('VERCEL','Import repo · build `npm run build` · output `dist`.'),
 ('LIVE DEMO','Follow a feed → open article → switch offline → Discover → opt-in share.')]
y=2.95
for label,detail in items:
    text(s,label,.98,y,1.35,.24,10,RED,True)
    text(s,detail,2.35,y-.03,5.2,.52,12,PAPER)
    y+=.78
rect(s,.98,6.2,6.3,.48,RGBColor(48,22,22),RGBColor(110,42,36))
text(s,'REPO INCLUDES README · SQL SEED · API ROUTES · TESTS · DEMO SCRIPT',1.1,6.32,6.05,.22,9.5,GOLD,True,align=PP_ALIGN.CENTER)

prs.save(OUT)
print(OUT)
