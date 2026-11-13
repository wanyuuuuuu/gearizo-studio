-- House voice and hashtag sets for caption writing.
--
-- Optional. The Edge Function has the same values built in as fallbacks, so
-- captions work before you run this. Insert the row when you want to change the
-- voice without redeploying the function — after this, editing the JSON here is
-- all it takes.
--
-- It lives in the same `docs` table everything else uses, so the studio's
-- existing access rules already cover it.

insert into docs (collection, id, data) values (
  'settings',
  'caption',
  jsonb_build_object(
    'voice',
    E'Open on a problem a Malaysian driver actually has. First line, no wind-up.\n'
    'Short sentences. No hype words. One emoji at most, usually none.\n'
    'Say the product name once, plainly. Gearizo is an officially authorised distributor\n'
    'of Michelin Lifestyle accessories — never imply Michelin made the vehicle or its\n'
    'parts, and make no tyre-performance claims.\n'
    'English: everyday Malaysian English. No slang that reads as try-hard.\n'
    'Manglish: lah, kan, ya only where a real person would say them.\n'
    'Bahasa Malaysia: plain spoken BM, not Dewan register.\n'
    '中文：用大马华语的语法和语气（「有」+动词、多过、罢了、句末咯、转不到／救不到、人家），\n'
    '不夹马来文词汇；battery、alternator、dashcam、jump、check 这类英文词照日常习惯保留。\n'
    'End with one clear next step: what to check, or where to buy.\n'
    'Never state a price, a discount or promo terms.',

    'hashtags', jsonb_build_object(
      'en',       '#Gearizo #MichelinLifestyle #CarAccessories #CarCareMY #Malaysia',
      'manglish', '#Gearizo #MichelinLifestyle #KeretaMalaysia #CarAccessoriesMY #TipsKereta',
      'bm',       '#Gearizo #MichelinLifestyle #AksesoriKereta #TipsKereta #KeselamatanJalanRaya',
      'zh',       '#Gearizo #MichelinLifestyle #汽车配件 #马来西亚车主 #用车知识'
    )
  )
)
on conflict (collection, id) do update set data = excluded.data;

-- To change the voice later:
--   update docs
--      set data = jsonb_set(data, '{voice}', to_jsonb('...new rules...'::text))
--    where collection = 'settings' and id = 'caption';
--
-- If the table's primary key is not (collection, id), adjust the ON CONFLICT
-- target to match — everything else is unchanged.
