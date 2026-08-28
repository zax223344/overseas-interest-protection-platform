/* 威胁组织模块 - threats.js v2.0 */
const THREAT_DATA={organizations:[{"id":"isis","name":"伊斯兰国","aliases":["ISIS","ISIL","DAESH","达伊沙"],"type":"恐怖组织","category":"宗教极端","subcategory":"逊尼派萨拉菲圣战","founded":"1999","foundedLocation":"阿富汗/伊拉克","status":"潜伏活跃","threatLevel":9.5,"threatTrend":"下降","leader":"阿布·哈夫斯·哈希米·库莱希","formerLeaders":["阿布·贝克尔·巴格达迪（2019击毙）","阿布·易卜拉欣·哈希米·库莱希（2022击毙）"],"members":"约5,000-10,000","operatingRegions":["伊拉克","叙利亚","阿富汗","利比亚","尼日利亚","埃及西奈","菲律宾","索马里"],"ideology":"建立跨国界伊斯兰哈里发国，推行极端萨拉菲派教法，对异教徒实施\"圣战\"","funding":"石油走私、文物走私、税收勒索、人口贩卖、外国捐赠","fundingEstimate":"鼎盛期年收入约20-30亿美元","designation":["联合国安理会1267委员会制裁","美国指定外国恐怖组织","中国公安部认定恐怖组织","欧盟指定恐怖组织"],"weaponLevel":"常规武器+IED+无人机改装","cyberCapability":"中等——擅长社交媒体宣传","description":"伊斯兰国是21世纪最具破坏力的恐怖组织。2014年攻占摩苏尔后宣布建立\"哈里发国\"，曾控制伊叙大片领土。2019年领土实体被消灭后转入游击和\"虚拟哈里发\"模式，在全球多地通过省分支和\"独狼\"袭击发动恐怖活动。其宣传机器极为高效，通过互联网招募了来自100多个国家的外国战斗人员。","structure":[{"role":"哈里发（最高领袖）","current":"阿布·哈夫斯·哈希米·库莱希","desc":"宗教与世俗最高权威"},{"role":"舒拉委员会","current":"约9-11名高级成员","desc":"决策咨询，推举哈里发"},{"role":"国防与军事委员会","current":"—","desc":"统筹全球军事行动"},{"role":"安全与情报总局","current":"—","desc":"内部安全、反间谍、海外情报"},{"role":"各省省长（瓦利）","current":"—","desc":"管理各\"省\"行政与军事"},{"role":"财政委员会","current":"—","desc":"管理资金来源与分配"},{"role":"媒体与宣传部门","current":"—","desc":"多语种媒体中心，视频/杂志/音频"},{"role":"宗教法理委员会","current":"—","desc":"发布教令、解释教法"}],"events":[{"date":"2014-06-10","title":"攻占摩苏尔","desc":"ISIS攻占伊拉克第二大城市，政府军溃败","casualties":"约50万平民流离失所","impact":"极端"},{"date":"2014-06-29","title":"宣布建立哈里发国","desc":"巴格达迪在摩苏尔努里清真寺宣布建国","casualties":"—","impact":"极端"},{"date":"2014-08-03","title":"雅兹迪种族灭绝","desc":"对辛贾尔山雅兹迪少数民族实施种族灭绝","casualties":"约5,000人被杀，7,000名妇女儿童被奴役","impact":"极端"},{"date":"2015-10-31","title":"俄罗斯客机爆炸","desc":"在埃及西奈半岛炸毁俄罗斯Metrojet航班","casualties":"224人死亡","impact":"极端"},{"date":"2015-11-13","title":"巴黎系列恐袭","desc":"巴黎多处协同恐怖袭击","casualties":"130人死亡，413人受伤","impact":"极端"},{"date":"2016-03-22","title":"布鲁塞尔恐袭","desc":"机场和地铁站自杀式爆炸","casualties":"32人死亡，340人受伤","impact":"极端"},{"date":"2019-03-23","title":"巴古斯村陷落","desc":"ISIS最后据点被攻陷，领土哈里发国灭亡","casualties":"—","impact":"极端"},{"date":"2019-10-27","title":"巴格达迪被击毙","desc":"美军突袭叙利亚伊德利卜，巴格达迪引爆炸弹身亡","casualties":"—","impact":"高"},{"date":"2022-01-20","title":"哈塞克监狱突袭","desc":"大规模越狱行动","casualties":"约500人死亡","impact":"高"},{"date":"2024-01-03","title":"克尔曼连环爆炸","desc":"ISIS-K在伊朗纪念苏莱曼尼集会发动爆炸","casualties":"94人死亡，284人受伤","impact":"极端"}],"statements":[{"date":"2014-07-05","source":"巴格达迪布道","content":"我是被真主选中的领袖，号召各地穆斯林向我效忠。建立哈里发国是所有穆斯林的宗教义务。"},{"date":"2014-09-21","source":"发言人阿德纳尼","content":"号召支持者在西方国家发动袭击：\"如果你不能迁徙到伊斯兰国，就在你所在的地方发动圣战。\""},{"date":"2015-05","source":"官方杂志《达比克》第7期","content":"\"我们将征服罗马，摧毁十字架。\"号召全球穆斯林加入\"哈里发国\"。"},{"date":"2016-07","source":"官方杂志《鲁米亚》第1期","content":"详细指导\"独狼\"如何在西方国家使用卡车进行恐袭，将\"孤狼袭击\"提升为正式战术。"},{"date":"2019-04-29","source":"阿玛克通讯社","content":"发布巴格达迪露面视频，承认领土损失但号召继续战斗：\"战斗即将进入新阶段。\""},{"date":"2024-01-04","source":"ISIS-K声明","content":"宣称对伊朗克尔曼爆炸负责，称是对\"伊朗及什叶派异教徒的报复\"。"}]},{"id":"alqaeda","name":"基地组织","aliases":["Al-Qaeda","AQ","盖达组织"],"type":"恐怖组织","category":"宗教极端","subcategory":"逊尼派萨拉菲圣战","founded":"1988","foundedLocation":"巴基斯坦白沙瓦","status":"分散活跃","threatLevel":8.5,"threatTrend":"稳定","leader":"赛义夫·阿德尔（代理）","formerLeaders":["本·拉登（2011击毙）","扎瓦希里（2022击毙）"],"members":"核心数百人，全球关联网络数千人","operatingRegions":["叙利亚","也门","索马里","萨赫勒","阿富汗","印度次大陆"],"ideology":"推翻阿拉伯世俗政权，驱逐西方势力，恢复伊斯兰哈里发，全球圣战","funding":"外国捐赠、绑架赎金、毒品贸易、商业掩护","fundingEstimate":"年收入约数千万美元","designation":["联合国安理会制裁","美国指定外国恐怖组织","中国公安部认定","欧盟指定"],"weaponLevel":"常规武器+IED+航空劫持","cyberCapability":"低","description":"基地组织由本·拉登于1988年创立，是全球圣战运动先驱。策划了\"9·11\"恐怖袭击，导致近3000人死亡。本·拉登被击毙后扎瓦希里接任，核心虽削弱但分支网络仍在扩张。与ISIS存在路线分歧——基地组织倾向长期渗透和渐进式斗争。目前其分支如阿拉伯半岛基地组织(AQAP)和萨赫勒分支仍构成重大威胁。","structure":[{"role":"埃米尔（最高领袖）","current":"赛义夫·阿德尔（代理）","desc":"战略决策与宗教权威"},{"role":"副埃米尔/顾问委员会","current":"—","desc":"协助最高领袖决策"},{"role":"军事委员会","current":"—","desc":"统筹全球军事行动"},{"role":"宗教法理委员会","current":"—","desc":"发布教令"},{"role":"媒体部门（萨哈卜）","current":"—","desc":"宣传视频和音频"},{"role":"各区域分支","current":"—","desc":"AQAP/AQIM/AQIS/青年党"}],"events":[{"date":"1998-08-07","title":"美国驻非大使馆爆炸","desc":"同时炸毁驻肯尼亚和坦桑尼亚大使馆","casualties":"224人死亡，4,000+人受伤","impact":"极端"},{"date":"2000-10-12","title":"科尔号驱逐舰爆炸","desc":"也门亚丁港小艇撞击美国军舰","casualties":"17名美军死亡","impact":"高"},{"date":"2001-09-11","title":"\"9·11\"恐怖袭击","desc":"劫持4架民航客机撞击世贸中心和五角大楼","casualties":"2,977人死亡，6,000+人受伤","impact":"极端"},{"date":"2002-10-12","title":"巴厘岛爆炸","desc":"印尼巴厘岛夜总会爆炸","casualties":"202人死亡","impact":"极端"},{"date":"2004-03-11","title":"马德里列车爆炸","desc":"马德里通勤列车炸弹","casualties":"193人死亡，2,000人受伤","impact":"极端"},{"date":"2005-07-07","title":"伦敦地铁爆炸","desc":"本土恐怖分子自杀式爆炸","casualties":"52人死亡，784人受伤","impact":"极端"},{"date":"2015-01-07","title":"查理周刊枪击","desc":"AQAP声称对巴黎查理周刊袭击负责","casualties":"12人死亡","impact":"高"},{"date":"2022-07-31","title":"扎瓦希里被击毙","desc":"美军无人机在喀布尔击毙扎瓦希里","casualties":"1人","impact":"高"}],"statements":[{"date":"1996-08-23","source":"本·拉登教令","content":"\"向美国宣战\"——号召穆斯林驱逐西方势力离开阿拉伯半岛，解放伊斯兰圣地。"},{"date":"1998-02-23","source":"本·拉登等联合教令","content":"\"杀死美国人和他们的盟友——平民和军人——是每个穆斯林的个体义务。\""},{"date":"2004-12-27","source":"本·拉登录音","content":"首次承认策划\"9·11\"袭击，称\"我们决定摧毁纽约和华盛顿的标志建筑\"。"},{"date":"2011-05-19","source":"扎瓦希里接任声明","content":"誓言继续本·拉登遗志，\"我们将加快步伐\"。"},{"date":"2022-08","source":"基地组织声明","content":"悼念扎瓦希里，誓言\"圣战不会停止\"。"}]},{"id":"bokoharam","name":"博科圣地","aliases":["Boko Haram","ISWAP"],"type":"恐怖组织","category":"宗教极端","subcategory":"逊尼派极端（反西方教育）","founded":"2002","foundedLocation":"尼日利亚迈杜古里","status":"活跃分裂","threatLevel":8,"threatTrend":"稳定","leader":"阿布·穆萨布·巴尔纳维（ISWAP）","formerLeaders":["穆罕默德·优素福（2009死亡）","阿布巴卡尔·谢考（2021死亡）"],"members":"约3,000-5,000","operatingRegions":["尼日利亚东北","喀麦隆北部","尼日尔","乍得"],"ideology":"禁止西方教育，建立伊斯兰教法治国，反对世俗政府","funding":"抢劫银行、绑架赎金、勒索村民、走私武器","fundingEstimate":"年收入约1,000万-2,000万美元","designation":["联合国安理会制裁","美国指定外国恐怖组织","中国公安部认定"],"weaponLevel":"常规武器+自杀炸弹+IED","cyberCapability":"极低","description":"博科圣地成立于2002年尼日利亚，名称意为\"西方教育是被禁止的\"。在尼日利亚东北部和乍得湖盆地制造严重人道主义危机，造成超过3.5万人死亡，约300万人流离失所。2015年宣誓效忠ISIS后改名ISWAP，但内部随后分裂。2014年绑架奇博克276名女学生事件引发全球#BringBackOurGirls运动。","structure":[{"role":"最高领袖（埃米尔）","current":"阿布·穆萨布·巴尔纳维","desc":"ISWAP派系领袖，获ISIS认可"},{"role":"谢考派系领导","current":"已分裂，多名头目","desc":"原始博科圣地残余"},{"role":"军事指挥官","current":"—","desc":"各地作战指挥"},{"role":"宗教领袖","current":"—","desc":"宗教合法性"},{"role":"后勤与招募","current":"—","desc":"物资补给、新成员训练"}],"events":[{"date":"2009-07-26","title":"迈杜古里暴动","desc":"与安全部队冲突，创始人优素福被击毙","casualties":"约800人死亡","impact":"高"},{"date":"2011-08-26","title":"联合国驻尼总部爆炸","desc":"自杀式汽车炸弹袭击驻阿布贾联合国总部","casualties":"23人死亡","impact":"极端"},{"date":"2014-04-14","title":"奇博克女学生绑架","desc":"从学校绑架276名女学生","casualties":"276人被绑","impact":"极端"},{"date":"2015-01-03","title":"巴嘎大屠杀","desc":"攻占尼日利亚东北部巴嘎镇","casualties":"约2,000人死亡","impact":"极端"},{"date":"2015-03-07","title":"宣誓效忠ISIS","desc":"谢考宣布效忠巴格达迪","casualties":"—","impact":"高"},{"date":"2021-05-19","title":"谢考死亡","desc":"与ISWAP交火中引爆自杀炸弹","casualties":"—","impact":"高"}],"statements":[{"date":"2014-05","source":"谢考视频","content":"\"我绑架了你们的女儿。她们应该结婚而不是上学。真主命令我出售她们。\""},{"date":"2015-03-07","source":"谢考音频","content":"\"我们宣誓效忠哈里发巴格达迪……我们听从他的命令。\""},{"date":"2016-08-03","source":"ISIS官方","content":"指定巴尔纳维为西非省新任领导人，取代谢考。"},{"date":"2018-02","source":"ISWAP声明","content":"威胁对基督教社区发动更多袭击，声称是对穆斯林遭受迫害的报复。"}]},{"id":"alshabaab","name":"青年党","aliases":["Al-Shabaab","索马里青年党"],"type":"恐怖组织","category":"宗教极端","subcategory":"逊尼派萨拉菲圣战","founded":"2006","foundedLocation":"索马里摩加迪沙","status":"活跃","threatLevel":7.5,"threatTrend":"稳定","leader":"艾哈迈德·奥马尔（阿布·乌拜达）","formerLeaders":["阿丹·艾罗（2008击毙）","莫克塔尔·祖贝尔（2014击毙）"],"members":"约7,000-9,000","operatingRegions":["索马里","肯尼亚","埃塞俄比亚","坦桑尼亚"],"ideology":"推翻索马里联邦政府，建立伊斯兰教法治国，驱逐外国势力","funding":"征税勒索、走私（木炭/甘蔗）、海盗分红、绑架赎金","fundingEstimate":"年收入约7,000万-1亿美元","designation":["联合国安理会制裁","美国指定外国恐怖组织","中国公安部认定"],"weaponLevel":"常规武器+自杀炸弹+IED","cyberCapability":"低——有媒体宣传能力","description":"青年党是索马里主要的伊斯兰极端武装组织，2006年从伊斯兰法院联盟中崛起。曾一度控制摩加迪沙及南部大部分地区。在非盟维和部队和索马里政府军打击下退守农村，但仍频繁发动恐怖袭击，尤其针对肯尼亚目标。2012年宣誓效忠基地组织，是非洲之角最致命的恐怖组织之一。","structure":[{"role":"埃米尔（最高领袖）","current":"艾哈迈德·奥马尔","desc":"最高军事和宗教权威"},{"role":"副埃米尔","current":"—","desc":"分管安全"},{"role":"舒拉委员会","current":"—","desc":"10名成员决策机构"},{"role":"军事行动指挥","current":"—","desc":"各区军事行动"},{"role":"情报与安全（阿姆尼亚特）","current":"—","desc":"情报、反间谍、暗杀"},{"role":"媒体中心","current":"—","desc":"电台和网站宣传"},{"role":"宗教法庭","current":"—","desc":"伊斯兰教法审判"}],"events":[{"date":"2010-07-11","title":"乌干达世界杯爆炸","desc":"坎帕拉世界杯观赛场所双重自杀爆炸","casualties":"74人死亡","impact":"极端"},{"date":"2013-09-21","title":"西门购物中心袭击","desc":"武装分子袭击内罗毕西门购物中心，持续4天","casualties":"67人死亡，175人受伤","impact":"极端"},{"date":"2015-04-02","title":"加里萨大学袭击","desc":"袭击肯尼亚加里萨大学，针对基督徒学生","casualties":"148人死亡","impact":"极端"},{"date":"2017-10-14","title":"摩加迪沙卡车爆炸","desc":"摩加迪沙热点酒店区卡车炸弹","casualties":"587人死亡，316人受伤","impact":"极端"},{"date":"2019-01-15","title":"内罗毕酒店袭击","desc":"袭击内罗毕都喜酒店综合体","casualties":"21人死亡","impact":"高"},{"date":"2020-01-05","title":"美军基地袭击","desc":"袭击肯尼亚辛巴营美军基地","casualties":"3人死亡","impact":"高"},{"date":"2022-10-29","title":"摩加迪沙双重爆炸","desc":"教育部附近两起汽车炸弹","casualties":"121人死亡，300人受伤","impact":"极端"}],"statements":[{"date":"2012-02-09","source":"青年党声明","content":"正式宣布效忠基地组织：\"我们与基地组织合为一体，听从扎瓦希里的命令。\""},{"date":"2013-09-21","source":"发言人","content":"宣称对西门购物中心袭击负责，称\"这是对肯尼亚在索马里军事行动的报复\"。"},{"date":"2015-04-02","source":"青年党声明","content":"\"我们已将加里萨大学从异教徒手中清除。这是对肯尼亚穆斯林遭受迫害的报复。\""},{"date":"2017-10-15","source":"发言人","content":"宣称对摩加迪沙大爆炸负责，称目标是\"军事和情报人员聚集地\"。"},{"date":"2022-10-30","source":"青年党声明","content":"宣称对摩加迪沙双重爆炸负责，称\"目标是教育部，回应政府对穆斯林的迫害\"。"}]},{"id":"taliban","name":"塔利班","aliases":["Taliban","阿富汗塔利班","阿塔","伊斯兰酋长国"],"type":"恐怖组织","category":"宗教极端","subcategory":"逊尼派德奥班迪教派","founded":"1994","foundedLocation":"阿富汗坎大哈","status":"执政（争议性）","threatLevel":7,"threatTrend":"上升","leader":"海巴图拉·阿洪扎达","formerLeaders":["穆罕默德·奥马尔（2013死亡）","阿赫塔尔·曼苏尔（2016击毙）"],"members":"约8万-10万（含安全部队）","operatingRegions":["阿富汗（全国）","巴基斯坦边境"],"ideology":"建立阿富汗伊斯兰酋长国，实施严格沙里亚法，反对西方化","funding":"毒品贸易（鸦片/海洛因）、矿产开采、税收、走私、外国资助","fundingEstimate":"年收入约10-15亿美元","designation":["联合国安理会制裁（部分领导人）","加拿大指定","部分国家未重新认定"],"weaponLevel":"常规军事装备（含美制遗留装备）","cyberCapability":"中等——活跃社交媒体宣传","description":"塔利班由奥马尔毛拉于1994年在坎大哈创立，1996-2001年曾统治阿富汗。2001年美国入侵后转入游击战。2021年8月美军撤离后迅速攻占全国，重新夺回政权，建立\"阿富汗伊斯兰酋长国\"。实施严格伊斯兰教法，严重限制女性权利。与巴基斯坦塔利班(TTP)和基地组织有复杂关系。政权目前未获国际普遍承认。","structure":[{"role":"最高埃米尔","current":"海巴图拉·阿洪扎达","desc":"最高政治军事宗教领袖，驻坎大哈"},{"role":"政治委员会主席","current":"—","desc":"对外政治事务"},{"role":"总理/内阁","current":"哈桑·阿洪德（代理总理）","desc":"行政事务管理"},{"role":"军事委员会","current":"亚库布·奥马尔","desc":"军事行动指挥"},{"role":"情报总局","current":"—","desc":"情报收集与安全"},{"role":"指导与劝善惩恶部","current":"—","desc":"实施伊斯兰教法监督"},{"role":"哈卡尼网络","current":"西拉杰丁·哈卡尼","desc":"半独立武装派系，城市袭击和外交"}],"events":[{"date":"1996-09-27","title":"首次攻占喀布尔","desc":"塔利班攻占首都，建立伊斯兰酋长国","casualties":"—","impact":"极端"},{"date":"2001-03","title":"巴米扬大佛摧毁","desc":"炸毁巴米扬两座千年佛像","casualties":"—","impact":"高"},{"date":"2001-11-13","title":"失守喀布尔","desc":"美国为首联军入侵，塔利班政权垮台","casualties":"—","impact":"极端"},{"date":"2020-02-29","title":"多哈协议签署","desc":"与美国签署和平协议","casualties":"—","impact":"极端"},{"date":"2021-08-15","title":"重返喀布尔","desc":"美军撤离期间迅速攻占全国","casualties":"—","impact":"极端"},{"date":"2021-08-26","title":"喀布尔机场爆炸","desc":"ISIS-K在喀布尔机场自杀式爆炸","casualties":"183人死亡（含13名美军）","impact":"极端"},{"date":"2022-12","title":"禁止女性上大学","desc":"颁布政令禁止女性接受大学教育","casualties":"—","impact":"高"}],"statements":[{"date":"2020-02-29","source":"与美国多哈联合声明","content":"\"塔利班承诺不允许任何团体或个人利用阿富汗领土威胁美国及其盟友安全。\""},{"date":"2021-08-17","source":"发言人穆贾希德","content":"\"我们已获得独立。我们将不再允许任何人利用阿富汗领土攻击其他国家。我们已赦免所有人。\""},{"date":"2021-09-07","source":"临时政府公告","content":"宣布成立阿富汗伊斯兰酋长国临时政府，承诺在伊斯兰教法框架内治理。"},{"date":"2022-12-20","source":"高等教育部","content":"\"即日起暂停女性在大学接受教育，直至进一步通知。\"引发国际强烈谴责。"},{"date":"2023-01","source":"阿洪扎达声明","content":"\"国际社会不应干涉我们内部事务。女性教育将在伊斯兰教法框架内解决。\""}]},{"id":"hezbollah","name":"真主党","aliases":["Hezbollah","Hizbullah","黎巴嫩真主党"],"type":"恐怖组织","category":"宗教极端","subcategory":"什叶派伊斯兰主义","founded":"1982","foundedLocation":"黎巴嫩贝鲁特","status":"活跃","threatLevel":6.5,"threatTrend":"上升","leader":"纳伊姆·卡西姆","formerLeaders":["阿巴斯·穆萨维（1992击毙）","哈桑·纳斯鲁拉（2024击毙）"],"members":"约2万-5万（含武装人员），议会13席","operatingRegions":["黎巴嫩","叙利亚","伊拉克","也门"],"ideology":"反抗以色列，建立伊朗式伊斯兰共和国，什叶派政治宗教合一","funding":"伊朗援助（年均数亿美元）、走私、合法商业、税收、毒品贸易","fundingEstimate":"年收入约10亿美元以上（含伊朗援助）","designation":["美国指定外国恐怖组织","欧盟指定军事翼为恐怖组织","阿拉伯联盟指定（部分时期）","中国未指定"],"weaponLevel":"先进——火箭弹、导弹、无人机、反舰导弹","cyberCapability":"中等——有网络战能力","description":"真主党是黎巴嫩什叶派政治和军事组织，1982年以色列入侵黎巴嫩后成立。兼具政党（在黎巴嫩议会占有席位）和武装组织双重身份。受伊朗深度资助和训练，拥有全球最强大的非国家武装力量之一。2006年与以色列爆发大规模冲突。深度介入叙利亚内战支持阿萨德政权。2023-2024年与以色列再次爆发边境冲突，纳斯鲁拉被以军击毙。","structure":[{"role":"总书记（最高领袖）","current":"纳伊姆·卡西姆","desc":"政治与军事最高决策者"},{"role":"舒拉委员会","current":"7名成员","desc":"最高决策机构"},{"role":"政治委员会","current":"—","desc":"国内政治事务"},{"role":"军事委员会/圣战委员会","current":"—","desc":"军事行动、武器管理、训练"},{"role":"执行委员会","current":"—","desc":"行政、社会服务"},{"role":"情报与安全机构","current":"—","desc":"情报、反间谍、海外行动"},{"role":"外部安全组织","current":"—","desc":"海外恐怖袭击与情报"},{"role":"媒体部门（灯塔电视台）","current":"—","desc":"卫星电视和网络媒体"},{"role":"社会服务网络","current":"—","desc":"医院、学校、福利——赢基层支持"}],"events":[{"date":"1983-04-18","title":"美驻贝鲁特使馆爆炸","desc":"卡车炸弹袭击美国大使馆","casualties":"63人死亡（含17名美国人）","impact":"极端"},{"date":"1983-10-23","title":"贝鲁特美军军营爆炸","desc":"自杀式卡车炸弹袭击美法维和部队军营","casualties":"307人死亡（241美军+58法军）","impact":"极端"},{"date":"2006-07-12","title":"黎以战争（33天战争）","desc":"越境袭击抓捕以军士兵引发大规模冲突","casualties":"约1,200黎巴嫩人死亡，165以色列人死亡","impact":"极端"},{"date":"2012-07-18","title":"布尔加斯旅游大巴爆炸","desc":"保加利亚机场炸毁以色列游客大巴","casualties":"7人死亡，32人受伤","impact":"高"},{"date":"2013-2018","title":"叙利亚内战介入","desc":"大规模派兵支持阿萨德政权","casualties":"数千名战士死亡","impact":"高"},{"date":"2023-10-08","title":"黎以边境冲突再起","desc":"哈马斯袭击次日，真主党开始北部边境袭扰","casualties":"持续升级","impact":"高"},{"date":"2024-09-17","title":"寻呼机爆炸事件","desc":"以色列对真主党通信设备发动供应链袭击","casualties":"约40人死亡，3,000余人受伤","impact":"极端"},{"date":"2024-09-27","title":"纳斯鲁拉被击毙","desc":"以色列空袭贝鲁特真主党总部","casualties":"数十人死亡","impact":"极端"}],"statements":[{"date":"2000-05","source":"纳斯鲁拉胜利演说","content":"\"这是阿拉伯历史上第一次以色列从我们的土地上撤退，不是通过谈判而是通过抵抗。\""},{"date":"2006-08","source":"纳斯鲁拉战后演说","content":"承认如果预知以色列反应不会下令抓捕士兵：\"如果知道反应是这样，就不会这样做。\""},{"date":"2011-10","source":"纳斯鲁拉声明","content":"支持叙利亚阿萨德政权：\"叙利亚抵抗阵线倒台将是对抵抗运动的巨大打击。\""},{"date":"2023-10-08","source":"纳斯鲁拉演说","content":"宣布声援加沙：\"黎巴嫩前线是为了减轻加沙的压力。\""},{"date":"2024-06-19","source":"纳斯鲁拉电视讲话","content":"威胁塞浦路斯如果允许以色列使用其基地将成为\"战争的一部分\"。"}]},{"id":"hamas","name":"哈马斯","aliases":["Hamas","伊斯兰抵抗运动","卡桑旅"],"type":"恐怖组织","category":"宗教极端","subcategory":"逊尼派穆斯林兄弟会分支","founded":"1987","foundedLocation":"巴勒斯坦加沙","status":"活跃（战时）","threatLevel":6,"threatTrend":"上升","leader":"叶海亚·辛瓦尔（2024击毙）/哈利勒·哈亚（代理）","formerLeaders":["艾哈迈德·亚辛（2004击毙）","阿卜杜勒·阿齐兹·兰提西（2004击毙）","伊斯梅尔·哈尼亚（2024击毙）","叶海亚·辛瓦尔（2024击毙）"],"members":"武装人员约2万-4万","operatingRegions":["加沙地带","约旦河西岸","黎巴嫩","卡塔尔（政治办公室）"],"ideology":"消灭以色列，建立伊斯兰巴勒斯坦国，穆斯林兄弟会巴勒斯坦分支","funding":"伊朗援助、卡塔尔援助、海外慈善网络（部分）、加密货币众筹、加沙税收","fundingEstimate":"年收入约3-5亿美元","designation":["美国指定外国恐怖组织","欧盟指定恐怖组织","以色列禁止组织","日本指定","中国未指定（视为巴勒斯坦政治力量）"],"weaponLevel":"火箭弹+地道网络+轻武器+无人机","cyberCapability":"低——有网络宣传能力","description":"哈马斯是巴勒斯坦伊斯兰抵抗运动，1987年第一次巴勒斯坦大起义中成立，是穆斯林兄弟会的加沙分支。2006年赢得加沙立法选举，2007年通过武力控制加沙地带，与法塔赫分裂。以以色列为首要目标，兼具政治治理和武装斗争双重角色。其军事分支卡桑旅负责武装行动。2023年10月7日发动\"阿克萨洪水\"行动突袭以色列，引发2023-2024年加沙战争，造成双方数万人伤亡。","structure":[{"role":"政治局主席","current":"哈利勒·哈亚（代理）","desc":"政治领袖，对外代表"},{"role":"政治局（舒拉）","current":"—","desc":"15名成员组成决策机构"},{"role":"加沙地带领导层","current":"叶海亚·辛瓦尔（已击毙）","desc":"加沙军事与行政指挥"},{"role":"卡桑旅（军事翼）","current":"穆罕默德·戴夫（已击毙）","desc":"军事行动总指挥"},{"role":"约旦河西岸指挥部","current":"—","desc":"西岸武装活动"},{"role":"海外领导层","current":"—","desc":"多哈、贝鲁特等办事处"},{"role":"安全部门","current":"—","desc":"内部安全、反间谍"},{"role":"媒体与宣传","current":"—","desc":"电视台、社交媒体、宣传材料"}],"events":[{"date":"1989-07-06","title":"首次绑架杀害以军士兵","desc":"绑架并杀害以色列士兵阿维·萨波斯塔斯和伊兰·萨阿东","casualties":"2人死亡","impact":"高"},{"date":"1994-04-06-04","title":"希伯伦清真寺屠杀报复","desc":"为报复希伯伦屠杀发动首次自杀式炸弹袭击","casualties":"8人死亡","impact":"高"},{"date":"1996-02-25","title":"耶路撒冷公交车爆炸","desc":"在耶路撒冷连续发动自杀式炸弹袭击","casualties":"26人死亡","impact":"极端"},{"date":"2001-2001","title":"第二次巴勒斯坦大起义","desc":"哈马斯在第二次起义中发动大量自杀式炸弹袭击","casualties":"数百以色列人死亡","impact":"极端"},{"date":"2007-06-15","title":"控制加沙","desc":"武力击败法塔赫，完全控制加沙地带","casualties":"约100-200人死亡","impact":"极端"},{"date":"2008-2009","title":"加沙战争（铸铅行动）","desc":"以色列大规模军事进攻加沙","casualties":"约1,400巴勒斯坦人死亡，13以色列人死亡","impact":"极端"},{"date":"2014-07-08","title":"加沙战争（护刃行动）","desc":"以色列大规模军事行动，历时50天","casualties":"约2,200巴勒斯坦人死亡，73以色列人死亡","impact":"极端"},{"date":"2023-10-07","title":"\"阿克萨洪水\"行动","desc":"哈马斯大规模突袭以色列南部，突破边境防线","casualties":"约1,200以色列人死亡，251人被绑架","impact":"极端"},{"date":"2023-10-07","title":"加沙战争爆发","desc":"以色列发动\"铁剑行动\"大规模空袭和地面进攻加沙","casualties":"截至2024年底：4万+巴勒斯坦人死亡","impact":"极端"},{"date":"2024-10-16","title":"辛瓦尔被击毙","desc":"以军在加沙南部击毙哈马斯领导人辛瓦尔","casualties":"—","impact":"极端"}],"statements":[{"date":"1988-08-18","source":"哈马斯成立宪章","content":"\"以色列将存在直到伊斯兰将其消灭……巴勒斯坦土地是伊斯兰信托土地，任何人都无权放弃哪怕一寸。\""},{"date":"2017-05-01","source":"新政策文件","content":"接受以1967年边界建立巴勒斯坦国，不再 formally 提及穆斯林兄弟会关联，但不正式承认以色列。"},{"date":"2023-10-07","source":"哈马斯军事声明","content":"宣布发动\"阿克萨洪水\"行动：\"这是对以色列占领和亵渎阿克萨清真寺的回应。\""},{"date":"2023-10-07","source":"哈马斯声明","content":"\"我们呼吁所有阿拉伯和伊斯兰国家以及自由世界的人民支持我们解放巴勒斯坦的斗争。\""},{"date":"2024-01-21","source":"哈马斯文件","content":"提出停火方案：永久停火、以军完全撤出加沙、交换所有被扣押人员、重建加沙。"}]},{"id":"sinaloa","name":"锡那罗亚贩毒集团","aliases":["Sinaloa Cartel","CDS","太平洋贩毒集团","古兹曼集团"],"type":"犯罪组织","category":"贩毒集团","subcategory":"跨国毒品贩运","founded":"1980s","foundedLocation":"墨西哥锡那罗亚州","status":"活跃","threatLevel":8,"threatTrend":"稳定","leader":"伊斯梅尔·赞巴达+洛斯·查帕托斯等多头目","formerLeaders":["华金·\"矮子\"·古兹曼（2023引渡美国）","伊格纳西奥·科罗内尔（2010击毙）"],"members":"数万人（含分销网络）","operatingRegions":["墨西哥","美国","加拿大","欧洲","澳大利亚","亚洲"],"ideology":"无意识形态——纯商业利益驱动","funding":"毒品贩运（可卡因、海洛因、冰毒、芬太尼）、武器走私、人口贩卖、洗钱","fundingEstimate":"年收入约30-110亿美元","designation":["美国财政部OFAC制裁","美国缉毒局重点目标","墨西哥政府打击目标"],"weaponLevel":"先进——自动武器、狙击步枪、自制装甲车、无人机","cyberCapability":"中等——利用加密通信和暗网","description":"锡那罗亚贩毒集团是墨西哥最大、最具影响力的跨国犯罪组织之一，由\"矮子\"古兹曼等人建立。控制着从南美到北美的多条毒品贩运走廊，是美国非法毒品的主要供应者。该集团拥有准军事力量，与竞争对手和墨西哥政府军频繁交火，造成墨西哥\"毒品战争\"中数万人死亡。芬太尼危机使其成为美国头号禁毒目标。古兹曼2023年被引渡美国后，组织陷入内部权力争夺。","structure":[{"role":"最高领导层","current":"赞巴达+多头目","desc":"战略决策与资源分配"},{"role":"安全护卫队（持枪者）","current":"—","desc":"武装护卫、暗杀、地盘争夺"},{"role":"后勤与运输部门","current":"—","desc":"陆地、海上、地下隧道运输"},{"role":"金融与洗钱部门","current":"—","desc":"全球洗钱网络、合法商业掩护"},{"role":"供应链管理","current":"—","desc":"原料采购、加工、分销"},{"role":"情报与贿赂网络","current":"—","desc":"渗透政府、收集执法情报"},{"role":"网络与技术部门","current":"—","desc":"加密通信、暗网销售、监控设备"}],"events":[{"date":"2001-01-19","title":"古兹曼首次越狱","desc":"\"矮子\"古兹曼从墨西哥最高安全级别监狱藏于洗衣车中逃出","casualties":"—","impact":"高"},{"date":"2008-2009","title":"锡那罗亚-贝尔特兰·莱瓦战争","desc":"与贝尔特兰·莱瓦集团内战，锡那罗亚州暴力激增","casualties":"数千人死亡","impact":"极端"},{"date":"2014-02-22","title":"古兹曼被抓获","desc":"美军和墨军在马萨特兰抓捕古兹曼","casualties":"—","impact":"高"},{"date":"2015-07-11","title":"古兹曼第二次越狱","desc":"通过1.5公里长隧道从最高安全监狱逃出","casualties":"—","impact":"极端"},{"date":"2016-01-08","title":"古兹曼再次被捕","desc":"墨西哥海军在洛斯莫奇斯抓捕古兹曼","casualties":"5人死亡","impact":"高"},{"date":"2017-2018","title":"芬太尼危机爆发","desc":"集团大规模向美国走私芬太尼，导致过量死亡激增","casualties":"数万美国人因芬太尼过量死亡","impact":"极端"},{"date":"2019-10-17","title":"奥维迪奥事件","desc":"古兹曼之子奥维迪奥被捕后，集团武装围攻库利亚坎市迫使政府释放","casualties":"约14人死亡","impact":"极端"},{"date":"2023-09","title":"古兹曼引渡美国","desc":"\"矮子\"古兹曼被引渡至美国受审","casualties":"—","impact":"高"},{"date":"2024-07-25","title":"赞巴达被捕","desc":"联合创始人赞巴达在美国被诱捕","casualties":"—","impact":"极端"}],"statements":[{"date":"2016-01","source":"古兹曼被捕后采访","content":"\"我出口的毒品比任何人都多。但我不是暴力的制造者，是需求方的问题。\""},{"date":"2019-10","source":"CDS武装人员","content":"围攻库利亚坎期间在社交媒体发布武装巡逻视频，展示对城市的控制力。"},{"date":"2023-09","source":"CDS内部通讯（ intercepted）","content":"讨论芬太尼生产：\"我们需要控制纯度，太多客户死了会影响生意。\""},{"date":"2024-08","source":"赞巴达被捕后声明","content":"声称被古兹曼之子绑架至美国，\"我是被武力带到这里来的\"。"}]},{"id":"yamaguchi","name":"山口组","aliases":["Yamaguchi-gumi","六代目山口组","神户山口组"],"type":"犯罪组织","category":"黑社会组织","subcategory":"日本指定暴力团","founded":"1915","foundedLocation":"日本神户","status":"分裂活跃","threatLevel":7,"threatTrend":"下降","leader":"筱田建市（司忍）","formerLeaders":["初代山口春吉","三代目田冈一雄","五代目渡边芳则"],"members":"约4,000-5,000（全盛期约4万）","operatingRegions":["日本全国","东南亚","美国（夏威夷/加州）"],"ideology":"极道精神——\"仁义\"、任侠、 hierarchy 原则（现代趋于商业利益）","funding":"保护费、建筑业敲诈、赌博、毒品贩运、色情产业、合法商业、股票操纵","fundingEstimate":"年收入约数十亿美元","designation":["日本指定暴力团","美国财政部制裁（跨国有组织犯罪）"],"weaponLevel":"枪支（非法持有）、刀具","cyberCapability":"低——传统犯罪模式","description":"山口组是日本最大的指定暴力团（黑社会组织），成立于1915年神户。鼎盛时期拥有约4万成员，控制日本有组织犯罪的大部分市场份额。组织有严格等级制度（若头、舍弟、直参等）和行为准则。2005年筱田建市就任第六代组长后强化合法商业经营。2015年内部发生大分裂，神户山口组脱离，导致日本黑社会间暴力冲突增加。日本《暴力团排除条例》实施后，成员大幅减少，组织被迫更多转向合法商业。","structure":[{"role":"组长（最高领袖）","current":"筱田建市（司忍）","desc":"绝对权威，最终决策者"},{"role":"若头（副组长）","current":"—","desc":"实际运营总指挥"},{"role":"舍弟","current":"—","desc":"组长顾问，资深直系组长"},{"role":"直参（直系组长）","current":"约70-90名","desc":"各二级团体领袖，拥有自己势力"},{"role":"若中","current":"—","desc":"直参下属的三级组长"},{"role":"构成员","current":"—","desc":"普通成员"},{"role":"旗下企业","current":"—","desc":"合法商业掩护——房地产、金融、建筑"},{"role":"神户山口组（分裂派）","current":"—","desc":"2015年脱离的竞争派系"}],"events":[{"date":"1985-01-26","title":"一乘会事件","desc":"竹中正久组长在大阪遭敌对组织暗杀","casualties":"组长及2名保镖死亡","impact":"高"},{"date":"2005-08-27","title":"筱田建市就任六代目","desc":"筱田建市在服刑期间被选为第六代组长","casualties":"—","impact":"高"},{"date":"2006-12","title":"司忍出狱","desc":"筱田建市刑满出狱，正式执掌山口组","casualties":"—","impact":"高"},{"date":"2011-04","title":"3·11后赈灾","desc":"东日本大地震后山口组率先向灾区运送物资","casualties":"—","impact":"中"},{"date":"2015-08-27","title":"山口组大分裂","desc":"13个直参团体脱离成立\"神户山口组\"","casualties":"—","impact":"极端"},{"date":"2015-2017","title":"分裂后暴力冲突","desc":"两派之间发生多起枪击和袭击事件","casualties":"数人死亡，多人受伤","impact":"高"},{"date":"2020-2022","title":"疫情期合法转型","desc":"新冠期间经营口罩生意、参与防疫物资配送","casualties":"—","impact":"中"},{"date":"2024","title":"成员持续减少","desc":"日本全国暴力团成员降至约2万人以下","casualties":"—","impact":"中"}],"statements":[{"date":"2011-03","source":"山口组声明","content":"东日本大地震后发布声明：\"我们虽然是暴力团，但也是日本人。灾区需要帮助，我们不会袖手旁观。\""},{"date":"2015-09","source":"山口组分裂后通知","content":"向日本警方提交分裂报告，正式承认神户山口组脱离。"},{"date":"2020-04","source":"山口组相关","content":"新冠疫情期间向医疗机构和养老院捐赠口罩和消毒液。"},{"date":"2023","source":"筱田建市内部训令","content":"禁止成员使用社交媒体炫耀财富，要求低调行事以应对执法压力。"}]},{"id":"ndrangheta","name":"光荣会","aliases":["'Ndrangheta","卡拉布里亚黑手党","拉德里纳"],"type":"犯罪组织","category":"黑社会组织","subcategory":"意大利有组织犯罪","founded":"19世纪末","foundedLocation":"意大利卡拉布里亚","status":"活跃","threatLevel":7.5,"threatTrend":"上升","leader":"多头目制（三个\"曼达门托\"联盟）","formerLeaders":["萨韦里奥·马莫利（已抓捕）","多梅尼科·韦特拉莱（已抓捕）"],"members":"约6,000+（含关联人员超过1万）","operatingRegions":["意大利（卡拉布里亚/伦巴第）","德国","荷兰","澳大利亚","加拿大","美国","南美"],"ideology":"\"缄默法则\"（Omertà）、血亲宗族、家族忠诚","funding":"可卡因贩运（控制欧洲80%市场）、武器走私、洗钱、公共工程腐败、绑架","fundingEstimate":"年收入约500-700亿美元","designation":["意大利反黑法指定","欧盟有组织犯罪重点打击目标","美国FBI跨国犯罪目标"],"weaponLevel":"枪支+炸弹+纵火","cyberCapability":"低——传统犯罪模式但利用现代金融工具洗钱","description":"光荣会是意大利三大黑手党组织中最强大和最富有的，发源于卡拉布里亚地区。以血缘家族为组织基础，极难渗透。据估计控制着欧洲可卡因进口的80%份额，是全球最富有的犯罪组织之一。其全球网络覆盖南美到欧洲的毒品供应链。与拉美贩毒集团直接合作进口可卡因。通过合法商业（房地产、餐饮、金融）洗白巨额资金。2019年意大利最大反黑行动\"Rinascita-Scott\"逮捕334名成员。","structure":[{"role":"最高层面（Crime/Il Crimine）","current":"—","desc":"全球战略协调机构，每年召开峰会"},{"role":"三个曼达门托","current":"—","desc":"La（平原）、Ionica（爱奥尼亚）、Montana（山区）三大联盟"},{"role":"曼达门托领导（Capo locale）","current":"—","desc":"各区域负责人"},{"role":"家族（Famiglia）","current":"—","desc":"以血缘为纽头的核心犯罪单元"},{"role":"犯罪活动部门","current":"—","desc":"毒品、武器、洗钱、公共工程各条线"},{"role":"海外分支","current":"—","desc":"德国、澳大利亚、加拿大、美国等"},{"role":"合法商业网络","current":"—","desc":"房地产、金融、餐饮等掩护企业"}],"events":[{"date":"1991-2007","title":"第二次黑手党战争","desc":"光荣会内部各家族长期血腥内战","casualties":"约500-600人死亡","impact":"极端"},{"date":"2007-08-15","title":"杜伊斯堡屠杀","desc":"在德国杜伊斯堡意大利餐厅外枪杀6名敌对家族成员","casualties":"6人死亡","impact":"极端"},{"date":"2010-07-13","title":"利贝拉反黑行动","desc":"意大利警方在卡拉布里亚大规模反黑行动","casualties":"—","impact":"高"},{"date":"2014-04","title":"教皇方济各访问","desc":"教皇方济各亲自前往卡拉布里亚谴责光荣会","casualties":"—","impact":"中"},{"date":"2019-12-19","title":"Rinascita-Scott行动","desc":"意大利最大规模反黑行动，逮捕334名成员","casualties":"—","impact":"极端"},{"date":"2021-10-12","title":"欧洲可卡因最大查获","desc":"意大利警方查获5.5吨可卡因，与光荣会有关","casualties":"—","impact":"高"},{"date":"2023-10","title":"德国大规模打击","desc":"德国警方在多地搜查光荣会关联设施","casualties":"—","impact":"高"}],"statements":[{"date":"2014-03-21","source":"教皇方济各","content":"\"那些属于光荣会的人不在天主的共融之中，他们是分裂的基督徒，他们的称谓是犹大的称谓。\""},{"date":"2019-12-19","source":"意大利检察官声明","content":"\"Rinascita-Scott行动揭示了一个完整的平行国家——光荣会在卡拉布里亚拥有自己的司法、立法和行政系统。\""},{"date":"2021-10","source":"欧洲刑警组织报告","content":"\"光荣会控制了欧洲约80%的可卡因进口，其全球网络延伸至南美原产地和欧洲所有主要市场。\""}]},{"id":"bla","name":"俾路支解放军","aliases":["BLA","Balochistan Liberation Army","俾路支解放武装"],"type":"恐怖组织","category":"民族分离","subcategory":"俾路支民族主义武装","founded":"2000","foundedLocation":"巴基斯坦俾路支省","status":"活跃","threatLevel":8.5,"threatTrend":"上升","leader":"巴希尔·泽布（公开信息有限）","formerLeaders":["阿斯拉姆·俾路支（2019/2020死亡）"],"members":"约数百至数千人","operatingRegions":["巴基斯坦","阿富汗","伊朗"],"ideology":"俾路支民族独立，反对外来投资与中央政府资源控制","funding":"跨境走私、外部捐助、绑架赎金","fundingEstimate":"据公开报道难以估算","designation":["美国指定外国恐怖组织（2019）","巴基斯坦政府列禁","英国指定恐怖组织","欧盟指定恐怖组织"],"weaponLevel":"轻武器+IED+自杀式袭击","cyberCapability":"低——主要通过社交媒体发布声明","description":"俾路支解放军（BLA）是巴基斯坦俾路支省主要分离主义武装组织之一，2000年前后从俾路支学生组织中分化而来。该组织以俾路支独立为目标，频繁袭击巴基斯坦安全部队、政府设施及被视为代表外来经济利益的目标。2018年以来，该组织多次将矛头指向中巴经济走廊（CPEC）项目和中国公民。2019年美国国务院将其列入外国恐怖组织名单，其下属“马吉德旅”以自杀式袭击著称。","structure":[{"role":"最高指挥官","current":"巴希尔·泽布","desc":"组织战略决策"},{"role":"马吉德旅","current":"—","desc":"自杀式袭击分支"},{"role":"军事委员会","current":"—","desc":"行动策划"},{"role":"情报与安全部门","current":"—","desc":"目标侦察与内部安全"},{"role":"宣传部门","current":"—","desc":"媒体声明与网络信息发布"}],"events":[{"date":"2018-11-23","title":"卡拉奇中国领事馆遇袭","desc":"BLA袭击中国驻卡拉奇总领事馆","casualties":"4人死亡（含2名警察）","impact":"高"},{"date":"2019-05-11","title":"瓜达尔珍珠洲际酒店袭击","desc":"BLA武装分子袭击瓜达尔港附近酒店，酒店内有中国及其他外国投资者","casualties":"至少5人死亡（含4名袭击者）","impact":"高"},{"date":"2022-04-26","title":"卡拉奇大学孔子学院班车爆炸","desc":"BLA马吉德旅女性自杀式袭击者袭击孔子学院班车","casualties":"4人死亡，包括3名中国公民","impact":"极高"},{"date":"2024-10-06","title":"卡拉奇国际机场附近中资企业车队遇袭","desc":"BLA对卡拉奇真纳国际机场附近中资企业车队发动自杀式袭击","casualties":"2名中国公民死亡，多人受伤","impact":"极高"}],"statements":[{"date":"2022-04","source":"BLA声明","content":"宣称对卡拉奇大学孔子学院班车袭击负责，称目标是“中国项目及其人员”。"},{"date":"2024-10","source":"BLA声明","content":"宣称对卡拉奇机场附近中资企业车队袭击负责，再次警告外国投资者。"}]},{"id":"ttp","name":"巴基斯坦塔利班","aliases":["TTP","Tehrik-e Taliban Pakistan","巴基斯坦塔利班运动"],"type":"恐怖组织","category":"宗教极端","subcategory":"逊尼派萨拉菲圣战","founded":"2007","foundedLocation":"巴基斯坦联邦直辖部落地区","status":"活跃","threatLevel":8.5,"threatTrend":"上升","leader":"努尔·瓦利·马哈苏德","formerLeaders":["贝图拉·马哈苏德（2009击毙）","哈基穆拉·马哈苏德（2013击毙）","法兹卢拉（2018击毙）"],"members":"约3,000-6,000人","operatingRegions":["巴基斯坦","阿富汗"],"ideology":"推翻巴基斯坦政府，建立伊斯兰教法国家，袭击北约及巴安全部队","funding":"绑架赎金、抢劫、外部捐助、毒品贸易","fundingEstimate":"年收入数千万美元","designation":["联合国安理会1267委员会制裁","美国指定外国恐怖组织","巴基斯坦列禁"],"weaponLevel":"轻武器+IED+自杀式炸弹","cyberCapability":"中——利用社交媒体宣传","description":"巴基斯坦塔利班（TTP）是巴基斯坦最主要的圣战武装组织之一，2007年由多个部落武装合并成立。该组织在巴基斯坦西北部频繁发动针对安全部队、学校、平民和外国目标的袭击，并与阿富汗塔利班保持复杂关系。TTP活动范围覆盖中巴经济走廊北线经过的开伯尔-普什图省，对中方人员和项目构成现实威胁。","structure":[{"role":"埃米尔","current":"努尔·瓦利·马哈苏德","desc":"最高领导人"},{"role":"军事委员会","current":"—","desc":"袭击策划"},{"role":"舒拉委员会","current":"—","desc":"决策咨询"},{"role":"宣传部门","current":"—","desc":"媒体与网络信息发布"}],"events":[{"date":"2007-12","title":"TTP成立","desc":"多个部落武装合并成立巴基斯坦塔利班","casualties":"—","impact":"高"},{"date":"2014-12-16","title":"白沙瓦学校屠杀","desc":"TTP袭击白沙瓦军人子弟学校","casualties":"149人死亡，含132名学生","impact":"极端"},{"date":"2021-08","title":"阿富汗塔利班胜利后攻势","desc":"TTP趁阿富汗局势变化加大在巴袭击频率","casualties":"数百人伤亡","impact":"高"},{"date":"2023-01","title":"白沙瓦清真寺爆炸","desc":"TTP在白沙瓦警察局附近清真寺发动自杀式爆炸","casualties":"100+人死亡","impact":"极高"}],"statements":[{"date":"2021-08","source":"TTP声明","content":"在阿富汗塔利班胜利后呼吁巴基斯坦政府接受其政治条件。"}]},{"id":"etim","name":"东突厥斯坦伊斯兰运动","aliases":["ETIM","TIP","突厥斯坦伊斯兰党","东伊运"],"type":"恐怖组织","category":"宗教极端","subcategory":"分裂主义圣战","founded":"1993","foundedLocation":"中国新疆/巴基斯坦瓦济里斯坦","status":"潜伏活跃","threatLevel":8,"threatTrend":"稳定","leader":"不详","formerLeaders":["艾山·买合苏木（2003击毙）","阿卜杜勒·哈克（2010击毙）"],"members":"约200-300名骨干","operatingRegions":["中国新疆","阿富汗","巴基斯坦","叙利亚","土耳其","中亚"],"ideology":"以暴力分裂中国新疆，建立所谓“东突厥斯坦”","funding":"境外捐助、犯罪活动、毒品与武器走私","fundingEstimate":"规模较小","designation":["联合国安理会1267委员会制裁","美国指定外国恐怖组织","中国公安部认定恐怖组织","欧盟指定恐怖组织"],"weaponLevel":"轻武器+IED","cyberCapability":"低","description":"东突厥斯坦伊斯兰运动（ETIM）是被联合国、中国、美国等多国认定的恐怖组织。该组织以暴力分裂中国新疆为目标，曾在境外策划和实施针对中国驻外机构及人员的袭击图谋。其核心成员长期流窜于阿富汗-巴基斯坦边境及叙利亚等地，被中国视为“东突”恐怖势力的主要代表。","structure":[{"role":"领导人","current":"不详","desc":"分散领导"},{"role":"军事委员会","current":"—","desc":"袭击策划"},{"role":"宣传部门","current":"—","desc":"网络视频与音频宣传"},{"role":"海外网络","current":"—","desc":"中亚、中东活动"}],"events":[{"date":"2008","title":"北京奥运会威胁","desc":"威胁对北京奥运会发动袭击，将新疆问题国际化","casualties":"未遂","impact":"高"},{"date":"2011","title":"艾山·买合苏木之子被击毙","desc":"在巴基斯坦瓦济里斯坦地区遭美军无人机空袭死亡","casualties":"—","impact":"高"},{"date":"2013-2017","title":"叙利亚参战","desc":"部分成员潜入叙利亚参与内战","casualties":"—","impact":"高"}],"statements":[{"date":"2008","source":"TIP视频声明","content":"威胁对北京奥运会发动袭击，将新疆问题国际化。"}]},{"id":"let","name":"虔诚军","aliases":["Lashkar-e-Taiba","LeT","正义军"],"type":"恐怖组织","category":"宗教极端","subcategory":"克什米尔圣战武装","founded":"1990","foundedLocation":"巴基斯坦旁遮普省","status":"活跃","threatLevel":8.5,"threatTrend":"稳定","leader":"哈菲兹·赛义德（被联合国制裁）","formerLeaders":[],"members":"数千人","operatingRegions":["巴基斯坦","印度","阿富汗"],"ideology":"在克什米尔及印度建立伊斯兰统治，对印度发动圣战","funding":"公开慈善机构、海外捐助、犯罪活动","fundingEstimate":"年收入数千万美元","designation":["联合国安理会1267委员会制裁","美国指定外国恐怖组织","印度指定恐怖组织","巴基斯坦部分时期列禁"],"weaponLevel":"轻武器+IED+自杀式袭击","cyberCapability":"中——利用社交媒体与网站宣传","description":"虔诚军是巴基斯坦境内规模较大的克什米尔圣战武装组织，被联合国、美国、印度等多国列为恐怖组织。该组织被指控多次发动针对印度目标的重大袭击，包括2008年孟买连环恐怖袭击。","structure":[{"role":"埃米尔","current":"哈菲兹·赛义德","desc":"创始人与精神领袖"},{"role":"军事委员会","current":"—","desc":"行动指挥"},{"role":"慈善掩护网络","current":"—","desc":"资金筹集与人员招募"}],"events":[{"date":"2001-12-13","title":"印度议会袭击","desc":"袭击印度议会大楼，引发印巴军事对峙","casualties":"9人死亡","impact":"极高"},{"date":"2008-11-26","title":"孟买连环恐袭","desc":"LeT武装分子袭击孟买多个目标","casualties":"166人死亡","impact":"极端"},{"date":"2019-02-14","title":"普尔瓦马袭击","desc":"自杀式汽车炸弹袭击印度准军事车队","casualties":"40人死亡","impact":"高"}],"statements":[{"date":"2008-12","source":"LeT发言人","content":"否认参与孟买袭击，但要求国际社会关注克什米尔问题。"}]},{"id":"jem","name":"穆罕默德军","aliases":["Jaish-e-Mohammed","JeM","穆罕默德战士"],"type":"恐怖组织","category":"宗教极端","subcategory":"克什米尔圣战武装","founded":"2000","foundedLocation":"巴基斯坦俾路支省","status":"活跃","threatLevel":8.5,"threatTrend":"稳定","leader":"马苏德·阿查尔（联合国制裁）","formerLeaders":[],"members":"数百至数千人","operatingRegions":["巴基斯坦","印度","阿富汗"],"ideology":"将克什米尔从印度分离并建立伊斯兰政权","funding":"海外捐助、犯罪活动、绑架赎金","fundingEstimate":"规模中等","designation":["联合国安理会1267委员会制裁","美国指定外国恐怖组织","印度指定恐怖组织","巴基斯坦部分时期列禁","欧盟指定恐怖组织"],"weaponLevel":"轻武器+IED+自杀式炸弹","cyberCapability":"低——主要通过社交媒体发布声明","description":"穆罕默德军是2000年在巴基斯坦成立的克什米尔圣战武装，以发动高调袭击著称，包括2001年印度议会袭击和2019年普尔瓦马自杀式炸弹袭击。","structure":[{"role":"埃米尔","current":"马苏德·阿查尔","desc":"最高领袖"},{"role":"军事指挥官","current":"—","desc":"袭击策划"},{"role":"招募网络","current":"—","desc":"南亚地区招募"}],"events":[{"date":"2001-12-13","title":"印度议会袭击","desc":"袭击印度议会，引发印巴军事紧张","casualties":"9人死亡","impact":"极高"},{"date":"2019-02-14","title":"普尔瓦马袭击","desc":"自杀式炸弹袭击中央后备警察部队车队","casualties":"40人死亡","impact":"极高"},{"date":"2020-02","title":"巴拉科特空袭","desc":"印度越境空袭疑似JeM营地，引发两国局势升级","casualties":"伤亡数字争议","impact":"高"}],"statements":[{"date":"2019-02","source":"JeM声明","content":"宣称对普尔瓦马袭击负责，称是对印度在克什米尔政策的报复。"}]},{"id":"haqqani","name":"哈卡尼网络","aliases":["Haqqani Network","哈卡尼集团"],"type":"恐怖组织","category":"宗教极端","subcategory":"普什图圣战网络","founded":"1970s","foundedLocation":"阿富汗帕克蒂亚省/北瓦济里斯坦","status":"活跃","threatLevel":8.5,"threatTrend":"稳定","leader":"西拉杰丁·哈卡尼","formerLeaders":["贾拉勒丁·哈卡尼（2018死亡）"],"members":"数千人","operatingRegions":["阿富汗","巴基斯坦"],"ideology":"建立伊斯兰酋长国，与塔利班目标一致","funding":"绑架赎金、毒品贸易、外部捐助、塔利班支持","fundingEstimate":"年收入数千万美元","designation":["联合国安理会制裁","美国指定外国恐怖组织"],"weaponLevel":"轻武器+IED+自杀式炸弹+火箭弹","cyberCapability":"低","description":"哈卡尼网络是阿富汗-巴基斯坦边境地区最具影响力的武装组织之一，与塔利班关系密切但保持半独立运作。以复杂的城市袭击和绑架行动著称，被联合国和美国列为恐怖组织。","structure":[{"role":"领导人","current":"西拉杰丁·哈卡尼","desc":"2021年后任阿富汗塔利班政府内政部长"},{"role":"军事指挥官","current":"—","desc":"跨境袭击指挥"},{"role":"资金网络","current":"—","desc":"绑架与走私收益"}],"events":[{"date":"2008-07-07","title":"喀布尔印度使馆爆炸","desc":"自杀式汽车炸弹袭击印度驻喀布尔使馆","casualties":"58人死亡","impact":"高"},{"date":"2011-09-13","title":"喀布尔美国使馆袭击","desc":"袭击美国使馆及北约总部","casualties":"16人死亡","impact":"高"},{"date":"2018-01-20","title":"洲际酒店袭击","desc":"袭击喀布尔洲际酒店","casualties":"22人死亡","impact":"高"}],"statements":[{"date":"2021-09","source":"塔利班政府公告","content":"西拉杰丁·哈卡尼出任阿富汗伊斯兰酋长国内政部长。"}]},{"id":"isis_k","name":"伊斯兰国呼罗珊省","aliases":["ISIS-K","ISKP","ISIS-Khorasan"],"type":"恐怖组织","category":"宗教极端","subcategory":"逊尼派萨拉菲圣战","founded":"2015","foundedLocation":"阿富汗/巴基斯坦边境","status":"活跃","threatLevel":9,"threatTrend":"上升","leader":"沙拉夫丁·莫塔津（公开信息有限）","formerLeaders":["哈菲兹·赛义德·汗（2015击毙）"],"members":"约1,000-5,000人","operatingRegions":["阿富汗","巴基斯坦","中亚","伊朗"],"ideology":"在呼罗珊地区建立哈里发国，袭击什叶派、西方及塔利班目标","funding":"抢劫、勒索、外部捐助、阿富汗混乱局势中获利","fundingEstimate":"规模中等","designation":["联合国安理会1267委员会制裁","美国指定外国恐怖组织","欧盟指定恐怖组织"],"weaponLevel":"轻武器+IED+自杀式炸弹","cyberCapability":"中——利用社交媒体宣传","description":"ISIS-K是伊斯兰国在阿富汗-巴基斯坦地区的分支，是ISIS最活跃和致命的分支之一。在塔利班重掌阿富汗后，ISIS-K发动多起针对清真寺、机场和外交设施的袭击。","structure":[{"role":"省长","current":"沙拉夫丁·莫塔津","desc":"呼罗珊省最高指挥官"},{"role":"军事委员会","current":"—","desc":"袭击策划"},{"role":"宣传部门","content":"—","desc":"媒体与网络宣传"}],"events":[{"date":"2021-08-26","title":"喀布尔机场爆炸","desc":"在机场外发动自杀式爆炸","casualties":"183人死亡（含13名美军）","impact":"极端"},{"date":"2022-09-30","title":"喀布尔俄罗斯使馆爆炸","desc":"袭击俄罗斯驻喀布尔使馆","casualties":"6人死亡","impact":"高"},{"date":"2024-01-03","title":"伊朗克尔曼爆炸","desc":"在纪念苏莱曼尼集会上发动连环爆炸","casualties":"94人死亡","impact":"极端"}],"statements":[{"date":"2024-01","source":"ISIS-K声明","content":"宣称对伊朗克尔曼爆炸负责，称袭击目标是什叶派异教徒。"}]},{"id":"lej","name":"先知信徒军","aliases":["Lashkar-e-Jhangvi","LeJ","羌格维军"],"type":"恐怖组织","category":"宗教极端","subcategory":"反什叶派极端组织","founded":"1996","foundedLocation":"巴基斯坦旁遮普省","status":"潜伏活跃","threatLevel":8,"threatTrend":"下降","leader":"多名头目已被击毙","formerLeaders":["里亚兹·巴锡（2002击毙）"],"members":"约数百人","operatingRegions":["巴基斯坦","阿富汗"],"ideology":"消灭什叶派穆斯林，在巴基斯坦建立萨拉菲派政权","funding":"海外捐助、犯罪活动","fundingEstimate":"规模较小","designation":["联合国安理会制裁","美国指定外国恐怖组织","巴基斯坦列禁"],"weaponLevel":"轻武器+IED+自杀式炸弹","cyberCapability":"低","description":"先知信徒军是巴基斯坦逊尼派极端组织，以袭击什叶派社区著称，被联合国和美国列为恐怖组织。其残余势力与ISIS-K等组织存在联系。","structure":[{"role":"最高指挥官","current":"不详","desc":"多头目已被击毙"},{"role":"行动小组","current":"—","desc":"分散袭击单元"}],"events":[{"date":"2013-01-10","title":"奎达爆炸","desc":"袭击什叶派聚居区","casualties":"100+人死亡","impact":"极端"},{"date":"2013-02-16","title":"哈扎拉社区爆炸","desc":"针对奎达哈扎拉社区市场炸弹","casualties":"89人死亡","impact":"极端"}],"statements":[]},{"id":"uwsa","name":"佤邦联合军","aliases":["UWSA","佤联军","缅甸佤邦联合军"],"type":"犯罪组织","category":"民族武装","subcategory":"缅甸少数民族武装","founded":"1989","foundedLocation":"缅甸掸邦","status":"活跃","threatLevel":6.5,"threatTrend":"稳定","leader":"鲍有祥","formerLeaders":[],"members":"约2万-3万人","operatingRegions":["缅甸","泰国","中国边境"],"ideology":"佤族自治，维护佤邦利益","funding":"矿产、赌博、毒品贩运、商业投资","fundingEstimate":"年收入数亿美元","designation":["缅甸政府视为民族武装组织","美国财政部制裁部分关联企业"],"weaponLevel":"常规武器（含重武器）","cyberCapability":"低","description":"佤邦联合军是缅甸最大的少数民族武装组织之一，控制掸邦北部佤邦地区。其与缅甸政府军保持停火协议，但涉及毒品贩运、网络赌博和矿产走私等问题。","structure":[{"role":"总司令","current":"鲍有祥","desc":"最高军事领导人"},{"role":"政治局","current":"—","desc":"行政决策"},{"role":"171军区","current":"—","desc":"泰缅边境部队"}],"events":[{"date":"1989","title":"脱离缅共成立佤邦","desc":"脱离缅甸共产党，与军政府达成停火","casualties":"—","impact":"高"},{"date":"2015","title":"美国制裁","desc":"美国财政部制裁佤邦相关网络赌博企业","casualties":"—","impact":"中"}],"statements":[]},{"id":"aa_myanmar","name":"若开军","aliases":["Arakan Army","AA","阿拉干军"],"type":"犯罪组织","category":"民族武装","subcategory":"缅甸少数民族武装","founded":"2009","foundedLocation":"缅甸若开邦","status":"活跃","threatLevel":7,"threatTrend":"上升","leader":"通米亚良","formerLeaders":[],"members":"约1万-3万人","operatingRegions":["缅甸若开邦","钦邦","孟加拉边境"],"ideology":"若开族民族自决，争取若开邦自治","funding":"税收、走私、外国支持","fundingEstimate":"规模中等","designation":["缅甸政府列为恐怖组织","美国制裁部分领导人"],"weaponLevel":"轻武器+重武器","cyberCapability":"低","description":"若开军是缅甸若开邦主要的民族武装组织，与缅甸政府军长期冲突。近年来军事能力显著增强，控制若开邦大部分地区，对当地中资企业项目和人员安全构成影响。","structure":[{"role":"总司令","current":"通米亚良","desc":"最高指挥官"},{"role":"联合若开军政治部门","current":"—","desc":"政治代表"}],"events":[{"date":"2018-12","title":"若开邦冲突升级","desc":"与缅军在若开邦多地发生激战","casualties":"数百人死亡","impact":"高"},{"date":"2019-01","title":"警方哨所袭击","desc":"袭击若开邦警察哨所","casualties":"13名警察死亡","impact":"高"},{"date":"2023-11","title":"缅北冲突扩大","desc":"与缅军在若开邦及钦邦展开大规模军事行动","casualties":"数千人伤亡","impact":"高"}],"statements":[]},{"id":"tnla","name":"德昂民族解放军","aliases":["TNLA","德昂军","Palaung State Liberation Front"],"type":"犯罪组织","category":"民族武装","subcategory":"缅甸少数民族武装","founded":"1992","foundedLocation":"缅甸掸邦北部","status":"活跃","threatLevel":6.5,"threatTrend":"上升","leader":"达崩觉","formerLeaders":[],"members":"约5,000-8,000人","operatingRegions":["缅甸掸邦北部"],"ideology":"德昂族民族自治","funding":"税收、毒品贸易、玉石走私","fundingEstimate":"规模中等","designation":["缅甸政府列为恐怖组织"],"weaponLevel":"轻武器+地雷","cyberCapability":"低","description":"德昂民族解放军是缅甸掸邦北部德昂族武装组织，参与缅北联盟军事行动。其活动区域涉及中缅边境贸易路线和能源管道周边。","structure":[{"role":"主席","current":"达崩觉","desc":"最高领导人"},{"role":"军事委员会","current":"—","desc":"作战指挥"}],"events":[{"date":"2015","title":"缅北冲突","desc":"与缅军在掸邦北部发生激烈冲突","casualties":"数百人伤亡","impact":"高"},{"date":"2023-10","title":"1027行动","desc":"参与缅北联盟对缅军的大规模进攻","casualties":"数千人伤亡","impact":"高"}],"statements":[]},{"id":"kia","name":"克钦独立军","aliases":["KIA","Kachin Independence Army"],"type":"犯罪组织","category":"民族武装","subcategory":"缅甸少数民族武装","founded":"1961","foundedLocation":"缅甸克钦邦","status":"活跃","threatLevel":6.5,"threatTrend":"稳定","leader":"恩板腊","formerLeaders":[],"members":"约8,000-10,000人","operatingRegions":["缅甸克钦邦","中缅边境"],"ideology":"克钦族民族自决","funding":"玉石贸易、税收、外国支持","fundingEstimate":"规模中等","designation":["缅甸政府列为非法武装"],"weaponLevel":"轻武器+重武器","cyberCapability":"低","description":"克钦独立军是缅甸历史最悠久的民族武装之一，控制克钦邦部分地区。其活动区域与中国在缅北的水电、矿业项目存在交集。","structure":[{"role":"总司令","current":"恩板腊","desc":"最高军事指挥官"},{"role":"克钦独立组织","current":"—","desc":"政治翼"}],"events":[{"date":"1994","title":"停火协议","desc":"与军政府签署17年停火协议","casualties":"—","impact":"高"},{"date":"2011","title":"停火破裂","desc":"与缅军爆发新一轮冲突","casualties":"数千人伤亡","impact":"高"}],"statements":[]},{"id":"abu_sayyaf","name":"阿布沙耶夫组织","aliases":["Abu Sayyaf Group","ASG","菲律宾伊斯兰武装"],"type":"恐怖组织","category":"宗教极端","subcategory":"分离主义圣战","founded":"1991","foundedLocation":"菲律宾巴西兰岛","status":"潜伏活跃","threatLevel":7.5,"threatTrend":"下降","leader":"拉杜兰·萨希隆（2017死亡）","formerLeaders":["阿布杜拉贾克·阿布巴卡尔·简加拉尼（1998击毙）"],"members":"约300-500人（鼎盛期数千）","operatingRegions":["菲律宾苏禄群岛","婆罗洲"],"ideology":"在菲律宾南部建立伊斯兰国家，通过绑架勒索筹资","funding":"绑架赎金、走私、外部捐助","fundingEstimate":"年收入数百万美元","designation":["联合国安理会制裁","美国指定外国恐怖组织","菲律宾列禁"],"weaponLevel":"轻武器+IED+绑架","cyberCapability":"低","description":"阿布沙耶夫是菲律宾南部极端武装组织，以绑架外国人质和海上绑架著称，与基地组织有历史联系。近年来在菲律宾军方打击下实力大减。","structure":[{"role":"领导人","current":"拉杜兰·萨希隆","desc":"2016-2017年领导人"},{"role":"地方指挥官","current":"—","desc":"各岛分散小组"}],"events":[{"date":"2000-04-23","title":"西帕丹岛绑架","desc":"绑架21名游客包括多名西方人","casualties":"全部获释","impact":"高"},{"date":"2017-05-23","title":"马拉维危机","desc":"与马乌特集团联合占领马拉维市","casualties":"约1,200人死亡","impact":"极高"},{"date":"2017-10-16","title":"萨希隆被击毙","desc":"菲律宾军方击毙其领导人","casualties":"—","impact":"高"}],"statements":[]},{"id":"maute","name":"马乌特集团","aliases":["Maute Group","伊斯兰马乌特"],"type":"恐怖组织","category":"宗教极端","subcategory":"ISIS菲律宾分支","founded":"2012","foundedLocation":"菲律宾棉兰老岛","status":"被重创","threatLevel":7,"threatTrend":"下降","leader":"奥马尔·马乌特（2017死亡）","formerLeaders":["阿卜杜拉·马乌特（2017死亡）"],"members":"约200-500人","operatingRegions":["菲律宾棉兰老岛"],"ideology":"在菲律宾建立哈里发国","funding":"毒品贸易、外部捐助、ISIS支持","fundingEstimate":"规模较小","designation":["菲律宾列禁","美国指定恐怖组织"],"weaponLevel":"轻武器+IED","cyberCapability":"低","description":"马乌特集团是菲律宾棉兰老岛极端武装，2017年与阿布沙耶夫联合占领马拉维市，引发持续五个月的马拉维危机。","structure":[{"role":"领导人","current":"奥马尔·马乌特","desc":"创始人之一"},{"role":"马乌特家族","current":"—","desc":"核心领导层"}],"events":[{"date":"2017-05-23","title":"马拉维占领","desc":"占领棉兰老岛马拉维市","casualties":"约1,200人死亡","impact":"极高"},{"date":"2017-10-23","title":"马拉维解放","desc":"菲军方宣布夺回马拉维","casualties":"—","impact":"高"}],"statements":[]},{"id":"jemaah_islamiyah","name":"伊斯兰祈祷团","aliases":["Jemaah Islamiyah","JI","伊斯兰团体"],"type":"恐怖组织","category":"宗教极端","subcategory":"东南亚圣战网络","founded":"1993","foundedLocation":"马来西亚/印尼","status":"潜伏活跃","threatLevel":7.5,"threatTrend":"下降","leader":"不详","formerLeaders":["阿布·巴卡尔·巴希尔（2020死亡）"],"members":"约数百人","operatingRegions":["印度尼西亚","马来西亚","菲律宾","泰国","澳大利亚"],"ideology":"在东南亚建立伊斯兰国家","funding":"海外捐助、犯罪活动、慈善掩护","fundingEstimate":"规模中等","designation":["联合国安理会制裁","美国指定外国恐怖组织","印尼列禁"],"weaponLevel":"炸弹+自杀式袭击","cyberCapability":"低","description":"伊斯兰祈祷团是东南亚最具影响力的圣战组织之一，与基地组织有历史联系，策划了2002年巴厘岛爆炸案。近年实力受挫但仍具威胁。","structure":[{"role":"精神领袖","current":"阿布·巴卡尔·巴希尔","desc":"创始人"},{"role":"行动小组","current":"—","desc":"分散单元"}],"events":[{"date":"2002-10-12","title":"巴厘岛爆炸","desc":"夜总会炸弹袭击","casualties":"202人死亡","impact":"极端"},{"date":"2003-08-05","title":"雅加达万豪酒店爆炸","desc":"汽车炸弹袭击酒店","casualties":"12人死亡","impact":"高"},{"date":"2009-07-17","title":"雅加达丽思卡尔顿爆炸","desc":"酒店连环爆炸","casualties":"9人死亡","impact":"高"}],"statements":[]},{"id":"mit","name":"东印尼圣战者","aliases":["MIT","Eastern Indonesia Mujahideen","圣战者东印尼"],"type":"恐怖组织","category":"宗教极端","subcategory":"ISIS印尼分支","founded":"2010","foundedLocation":"印度尼西亚中苏拉威西","status":"被重创","threatLevel":7,"threatTrend":"下降","leader":"阿里·卡洛拉（2016击毙）","formerLeaders":["桑托索（2016击毙）"],"members":"约数十人","operatingRegions":["印度尼西亚中苏拉威西"],"ideology":"在印尼建立伊斯兰国家，效忠ISIS","funding":"抢劫、绑架、外部捐助","fundingEstimate":"规模较小","designation":["美国指定外国恐怖组织","印尼列禁"],"weaponLevel":"轻武器+IED","cyberCapability":"低","description":"东印尼圣战者是印尼中苏拉威西的极端武装，曾宣誓效忠ISIS。经过多年军事清剿，其核心成员已被击毙，但残余势力仍在活动。","structure":[{"role":"领导人","current":"阿里·卡洛拉","desc":"末任领导人"},{"role":"残余成员","current":"—","desc":"分散潜伏"}],"events":[{"date":"2014","title":"宣誓效忠ISIS","desc":"宣布效忠巴格达迪","casualties":"—","impact":"高"},{"date":"2016","title":"桑托索被击毙","desc":"印尼安全部队击毙其领导人","casualties":"—","impact":"高"}],"statements":[]},{"id":"brn","name":"北大年马来民族革命阵线","aliases":["BRN","Barisan Revolusi Nasional","民族革命阵线"],"type":"犯罪组织","category":"民族武装","subcategory":"泰国南部分离武装","founded":"1963","foundedLocation":"泰国北大年","status":"活跃","threatLevel":6.5,"threatTrend":"稳定","leader":"集体领导","formerLeaders":[],"members":"约1,000-3,000人","operatingRegions":["泰国南部三府","马来西亚边境"],"ideology":"马来族独立，建立北大年独立国","funding":"海外捐助、犯罪活动、税收","fundingEstimate":"规模中等","designation":["泰国列禁"],"weaponLevel":"轻武器+IED+伏击","cyberCapability":"低","description":"BRN是泰国南部最主要的马来族分离武装组织，长期发动针对政府军、学校和平民的袭击。其活动区域靠近马来西亚边境，影响泰国南部稳定。","structure":[{"role":"舒拉委员会","current":"集体领导","desc":"决策机构"},{"role":"战斗小组","current":"—","desc":"分散行动单元"}],"events":[{"date":"2004","title":"塔克拜袭击","desc":"袭击警察局并盗取武器","casualties":"—","impact":"高"},{"date":"2019-11","title":"宋卡府袭击","desc":"伏击安全部队车辆","casualties":"15人死亡","impact":"高"}],"statements":[]},{"id":"huji_b","name":"孟加拉伊斯兰圣战运动","aliases":["HUJI-B","Harkat-ul-Jihad-al-Islami Bangladesh"],"type":"恐怖组织","category":"宗教极端","subcategory":"南亚圣战网络","founded":"1992","foundedLocation":"孟加拉国","status":"潜伏活跃","threatLevel":7,"threatTrend":"稳定","leader":"不详","formerLeaders":[],"members":"约数百人","operatingRegions":["孟加拉国","缅甸","印度"],"ideology":"在孟加拉国建立伊斯兰政权","funding":"海外捐助、犯罪活动","fundingEstimate":"规模较小","designation":["美国指定外国恐怖组织","孟加拉国列禁"],"weaponLevel":"轻武器+IED","cyberCapability":"低","description":"HUJI-B是孟加拉国激进组织，与基地组织和虔诚军有联系，被美国和孟加拉国列为恐怖组织。其成员涉及多起针对世俗人士和外国人的袭击。","structure":[{"role":"埃米尔","current":"不详","desc":"最高领袖"},{"role":"行动网络","current":"—","desc":"分散单元"}],"events":[{"date":"2001","title":"暗杀记者","desc":"杀害孟加拉记者","casualties":"1人死亡","impact":"高"},{"date":"2004","title":"谢赫·哈西娜袭击","desc":"暗杀时任反对派领袖未遂","casualties":"20人死亡","impact":"高"}],"statements":[]},{"id":"hts","name":"沙姆解放组织","aliases":["HTS","Hayat Tahrir al-Sham","努斯拉阵线","Jabhat al-Nusra"],"type":"恐怖组织","category":"宗教极端","subcategory":"叙利亚圣战武装","founded":"2012","foundedLocation":"叙利亚","status":"活跃（执政叙利亚过渡政府）","threatLevel":7.5,"threatTrend":"稳定","leader":"艾哈迈德·沙拉","formerLeaders":["阿布·穆罕默德·朱拉尼"],"members":"约1万-2万人","operatingRegions":["叙利亚","土耳其","黎巴嫩"],"ideology":"推翻阿萨德政权，在叙利亚建立伊斯兰政权","funding":"税收、走私、外部捐助、土耳其支持","fundingEstimate":"年收入数亿美元","designation":["联合国安理会制裁","美国指定外国恐怖组织","欧盟指定恐怖组织","土耳其列禁（后关系变化）"],"weaponLevel":"轻武器+重武器+IED","cyberCapability":"中","description":"HTS前身为努斯拉阵线，曾是基地组织叙利亚分支，后与基地组织切割并主导叙利亚反对派。2024年底推翻阿萨德政权后成为叙利亚过渡政府核心力量。","structure":[{"role":"领导人","current":"艾哈迈德·沙拉","desc":"叙利亚过渡政府事实领导人"},{"role":"舒拉委员会","current":"—","desc":"决策机构"},{"role":"军事指挥部","current":"—","desc":"作战指挥"}],"events":[{"date":"2016-07","title":"与基地组织切割","desc":"宣布改名为Jabhat Fateh al-Sham并脱离基地组织","casualties":"—","impact":"高"},{"date":"2017-01","title":"组建HTS","desc":"合并多个反对派武装成立HTS","casualties":"—","impact":"高"},{"date":"2024-12","title":"推翻阿萨德政权","desc":"HTS主导攻势攻占大马士革","casualties":"数千人伤亡","impact":"极端"}],"statements":[]},{"id":"ahrar","name":"自由沙姆人伊斯兰运动","aliases":["Ahrar al-Sham","黎凡特自由人"],"type":"恐怖组织","category":"宗教极端","subcategory":"叙利亚伊斯兰武装","founded":"2011","foundedLocation":"叙利亚伊德利卜","status":"活跃","threatLevel":6.5,"threatTrend":"下降","leader":"贾比尔·阿里·谢赫","formerLeaders":["哈桑·阿卜杜勒·加尼"],"members":"约数千人","operatingRegions":["叙利亚西北部"],"ideology":"在叙利亚建立伊斯兰政府","funding":"土耳其、卡塔尔支持，海外捐助","fundingEstimate":"规模中等","designation":["美国列为恐怖组织","俄罗斯列为恐怖组织"],"weaponLevel":"轻武器+重武器","cyberCapability":"低","description":"自由沙姆人是叙利亚内战中的重要伊斯兰武装组织，与土耳其关系密切。曾被美国和俄罗斯列为恐怖组织。","structure":[{"role":"领导人","current":"贾比尔·阿里·谢赫","desc":"最高指挥官"},{"role":"舒拉委员会","current":"—","desc":"决策机构"}],"events":[{"date":"2013","title":"成为主要反对派","desc":"在叙利亚西北部扩张势力","casualties":"—","impact":"高"},{"date":"2018","title":"伊德利卜冲突","desc":"与HTS在伊德利卜发生冲突","casualties":"数百人伤亡","impact":"高"}],"statements":[]},{"id":"asaib","name":"阿萨伊卜·阿赫勒·哈克","aliases":["Asaib Ahl al-Haq","AAH","正义联盟"],"type":"恐怖组织","category":"宗教极端","subcategory":"伊拉克什叶派民兵","founded":"2006","foundedLocation":"伊拉克","status":"活跃","threatLevel":7,"threatTrend":"稳定","leader":"卡伊斯·哈扎利","formerLeaders":[],"members":"约1万+人","operatingRegions":["伊拉克","叙利亚","黎巴嫩"],"ideology":"什叶派伊斯兰主义，反美反以色列，效忠伊朗","funding":"伊朗革命卫队圣城旅、伊拉克政府预算、商业活动","fundingEstimate":"年收入数千万美元","designation":["美国指定外国恐怖组织","美国制裁"],"weaponLevel":"常规武器+火箭弹+无人机","cyberCapability":"低","description":"AAH是伊拉克什叶派民兵组织，与伊朗关系密切。曾长期袭击驻伊拉克美军，现为伊拉克人民动员力量（PMF）组成部分，参与政治。","structure":[{"role":"秘书长","current":"卡伊斯·哈扎利","desc":"最高领导人"},{"role":"军事委员会","current":"—","desc":"民兵指挥"},{"role":"政治翼","current":"—","desc":"参与伊拉克议会"}],"events":[{"date":"2007","title":"绑架英国承包商","desc":"杀害5名英国安保人员","casualties":"5人死亡","impact":"高"},{"date":"2019-12","title":"袭击美国使馆","desc":"参与围攻美国驻巴格达使馆","casualties":"—","impact":"高"}],"statements":[]},{"id":"kataib_hezbollah","name":"真主党旅","aliases":["Kataib Hezbollah","KH","伊拉克真主党旅"],"type":"恐怖组织","category":"宗教极端","subcategory":"伊拉克什叶派民兵","founded":"2003","foundedLocation":"伊拉克","status":"活跃","threatLevel":7.5,"threatTrend":"上升","leader":"艾哈迈德·哈米达维","formerLeaders":["阿布·马赫迪·穆罕迪斯（2020美军空袭死亡）"],"members":"约数千至1万人","operatingRegions":["伊拉克","叙利亚"],"ideology":"什叶派伊斯兰主义，反美，效忠伊朗","funding":"伊朗革命卫队圣城旅、伊拉克政府预算","fundingEstimate":"年收入数千万美元","designation":["美国指定外国恐怖组织","美国制裁","伊拉克列禁（部分时期）"],"weaponLevel":"火箭弹+无人机+常规武器","cyberCapability":"中","description":"真主党旅是伊拉克最强大和激进的什叶派民兵之一，与伊朗革命卫队关系密切。多次袭击驻伊拉克美军和外交设施。","structure":[{"role":"领导人","current":"艾哈迈德·哈米达维","desc":"最高指挥官"},{"role":"军事委员会","current":"—","desc":"作战指挥"}],"events":[{"date":"2020-01-27","title":"美军空袭","desc":"美军空袭打死领导人穆罕迪斯和伊朗将领苏莱曼尼","casualties":"10人死亡","impact":"极高"},{"date":"2023-11","title":"袭击美军基地","desc":"多次用无人机和火箭弹袭击伊拉克美军基地","casualties":"—","impact":"高"}],"statements":[]},{"id":"aqap","name":"阿拉伯半岛基地组织","aliases":["AQAP","Al-Qaeda in the Arabian Peninsula","也门基地组织"],"type":"恐怖组织","category":"宗教极端","subcategory":"基地组织分支","founded":"2009","foundedLocation":"也门","status":"潜伏活跃","threatLevel":8,"threatTrend":"下降","leader":"哈立德·巴塔菲（2021死亡）","formerLeaders":["安瓦尔·奥拉基（2011美军无人机击毙）","纳赛尔·乌哈希（2015击毙）"],"members":"约数百至数千人","operatingRegions":["也门","沙特阿拉伯"],"ideology":"推翻沙特和也门政府，对西方发动袭击","funding":"抢劫、税收、绑架、外部捐助","fundingEstimate":"规模中等","designation":["联合国安理会制裁","美国指定外国恐怖组织","沙特列禁"],"weaponLevel":"轻武器+IED+爆炸装置","cyberCapability":"中——网络杂志《启发》","description":"AQAP是基地组织最危险的分支之一，策划了2009年圣诞节炸机未遂和2015年《查理周刊》袭击。在也门内战中曾控制大片领土。","structure":[{"role":"埃米尔","current":"哈立德·巴塔菲","desc":"最高领导人"},{"role":"军事委员会","current":"—","desc":"袭击策划"},{"role":"媒体部门","current":"—","desc":"《启发》杂志"}],"events":[{"date":"2009-12-25","title":"圣诞节炸机未遂","desc":" Nigerian 青年携带炸弹试图炸毁美国客机","casualties":"未遂","impact":"极高"},{"date":"2015-01-07","title":"查理周刊袭击","desc":"AQAP宣称对巴黎查理周刊枪击负责","casualties":"12人死亡","impact":"极高"},{"date":"2020-08","title":"美军空袭","desc":"美军无人机空袭打死领导人哈立德·巴塔菲","casualties":"1人","impact":"高"}],"statements":[{"date":"2010","source":"《启发》杂志","content":"号召在西方发动独狼式袭击，提供制作炸弹指南。"}]},{"id":"houthis","name":"胡塞武装","aliases":["Ansar Allah","胡塞运动","也门胡塞"],"type":"恐怖组织","category":"宗教极端","subcategory":"什叶派伊斯兰主义武装","founded":"1994","foundedLocation":"也门萨达省","status":"活跃（控制也门首都）","threatLevel":7.5,"threatTrend":"上升","leader":"阿卜杜勒-马利克·胡塞","formerLeaders":["侯赛因·胡塞（2004死亡）"],"members":"约数万至20万人","operatingRegions":["也门","沙特阿拉伯","红海","曼德海峡"],"ideology":"什叶派宰德派政治宗教运动，反美反以色列","funding":"伊朗支持、税收、走私","fundingEstimate":"年收入数亿美元","designation":["美国指定外国恐怖组织（2024）","联合国制裁部分领导人","沙特、阿联酋列禁"],"weaponLevel":"导弹+无人机+火箭弹+轻武器","cyberCapability":"中","description":"胡塞武装是也门宰德派反政府武装，2014年占领首都萨那，2015年起与沙特领导的联军作战。2023-2024年频繁使用导弹和无人机袭击红海商船及以色列目标，严重影响国际航运。","structure":[{"role":"最高领导人","current":"阿卜杜勒-马利克·胡塞","desc":"最高政治军事领袖"},{"role":"最高革命委员会","current":"—","desc":"政治决策"},{"role":"军事指挥部","current":"—","desc":"导弹与无人机部队"}],"events":[{"date":"2014-09","title":"占领萨那","desc":"攻占也门首都","casualties":"—","impact":"极高"},{"date":"2015-03","title":"沙特联军介入","desc":"沙特领导多国联军对胡塞发动空袭","casualties":"数万人伤亡","impact":"极高"},{"date":"2023-11","title":"红海袭船","desc":"使用导弹和无人机袭击红海国际商船","casualties":"—","impact":"极高"},{"date":"2024-01","title":"美英空袭","desc":"美英对胡塞目标发动多轮空袭","casualties":"—","impact":"高"}],"statements":[{"date":"2023-11","source":"胡塞武装声明","content":"宣布封锁红海，打击与以色列有关的船只。"}]},{"id":"pij","name":"巴勒斯坦伊斯兰圣战运动","aliases":["Palestinian Islamic Jihad","PIJ","杰哈德"],"type":"恐怖组织","category":"宗教极端","subcategory":"巴勒斯坦伊斯兰武装","founded":"1981","foundedLocation":"埃及加沙","status":"活跃","threatLevel":7,"threatTrend":"上升","leader":"齐亚德·纳哈拉","formerLeaders":["法蒂·什卡基（1995死亡）"],"members":"约数千人","operatingRegions":["加沙地带","约旦河西岸","黎巴嫩","伊朗"],"ideology":"消灭以色列，建立伊斯兰巴勒斯坦国","funding":"伊朗支持、叙利亚支持","fundingEstimate":"年收入数千万美元","designation":["美国指定外国恐怖组织","欧盟指定恐怖组织","以色列列禁"],"weaponLevel":"火箭弹+轻武器","cyberCapability":"低","description":"PIJ是仅次于哈马斯的巴勒斯坦伊斯兰武装组织，得到伊朗大量支持。频繁从加沙向以色列发射火箭弹，是以色列-巴勒斯坦冲突中的重要行为体。","structure":[{"role":"总书记","current":"齐亚德·纳哈拉","desc":"最高领导人"},{"role":"军事翼圣城旅","current":"—","desc":"军事行动"}],"events":[{"date":"2022-08","title":"黎明行动","desc":"以色列对PIJ目标发动军事行动","casualties":"49人死亡","impact":"高"},{"date":"2023-10","title":"阿克萨洪水响应","desc":"参与对以色列火箭弹袭击","casualties":"—","impact":"高"}],"statements":[]},{"id":"aqim","name":"伊斯兰马格里布基地组织","aliases":["AQIM","Al-Qaeda in the Islamic Maghreb","马格里布基地组织"],"type":"恐怖组织","category":"宗教极端","subcategory":"北非圣战组织","founded":"1998","foundedLocation":"阿尔及利亚","status":"潜伏活跃","threatLevel":7.5,"threatTrend":"下降","leader":"阿卜杜勒-马利克·德鲁克达尔（2020死亡）","formerLeaders":[],"members":"约数百至数千人","operatingRegions":["阿尔及利亚","马里","尼日尔","利比亚","布基纳法索"],"ideology":"在北非建立伊斯兰国家，袭击西方及当地政府","funding":"绑架赎金、走私、税收","fundingEstimate":"年收入数千万美元","designation":["联合国安理会制裁","美国指定外国恐怖组织","欧盟指定恐怖组织"],"weaponLevel":"轻武器+IED+绑架","cyberCapability":"低","description":"AQIM是基地组织在北非的分支，曾在北非和西非发动多起绑架和袭击。其部分成员后来分裂组成JNIM和ISGS。","structure":[{"role":"埃米尔","current":"阿卜杜勒-马利克·德鲁克达尔","desc":"长期领导人"},{"role":"撒哈拉分部","current":"—","desc":"萨赫勒地区行动"}],"events":[{"date":"2008","title":"加入基地组织","desc":"正式宣布效忠基地组织","casualties":"—","impact":"高"},{"date":"2013-01","title":"因阿迈纳斯人质危机","desc":"袭击阿尔及利亚天然气田","casualties":"67人死亡","impact":"极高"}],"statements":[]},{"id":"jnim","name":"支持伊斯兰与穆斯林群","aliases":["JNIM","Jamaat Nusrat al-Islam wal-Muslimin","西非圣战联盟"],"type":"恐怖组织","category":"宗教极端","subcategory":"萨赫勒圣战联盟","founded":"2017","foundedLocation":"马里","status":"活跃","threatLevel":8,"threatTrend":"上升","leader":"伊亚德·阿格·加力","formerLeaders":[],"members":"约2,000-5,000人","operatingRegions":["马里","布基纳法索","尼日尔","科特迪瓦"],"ideology":"在萨赫勒地区建立伊斯兰国家","funding":"绑架赎金、抢劫、税收、毒品贸易","fundingEstimate":"年收入数千万美元","designation":["联合国安理会制裁","美国指定外国恐怖组织","欧盟指定恐怖组织"],"weaponLevel":"轻武器+IED+伏击+火箭弹","cyberCapability":"低","description":"JNIM是2017年由多个萨赫勒圣战组织合并而成的联盟，与基地组织结盟。是马里、布基纳法索和尼日尔安全局势恶化的主要推手。","structure":[{"role":"埃米尔","current":"伊亚德·阿格·加力","desc":"最高领导人"},{"role":"安萨尔丁","current":"—","desc":"马里分支"},{"role":"穆拉比通","current":"—","desc":"跨国分支"}],"events":[{"date":"2017-03","title":"宣布成立","desc":"多个组织合并成立JNIM","casualties":"—","impact":"高"},{"date":"2017-06","title":"康加巴袭击","desc":"袭击马里旅游胜地","casualties":"5人死亡","impact":"高"},{"date":"2021-08","title":"马里政变","desc":"利用政治动荡扩大控制区","casualties":"—","impact":"高"}],"statements":[]},{"id":"isgs","name":"大撒哈拉伊斯兰国","aliases":["ISGS","Islamic State in the Greater Sahara","伊斯兰国大撒哈拉省"],"type":"恐怖组织","category":"宗教极端","subcategory":"ISIS萨赫勒分支","founded":"2015","foundedLocation":"马里/尼日尔边境","status":"活跃","threatLevel":8,"threatTrend":"上升","leader":"阿布·瓦利德·萨赫拉维（2021死亡）","formerLeaders":[],"members":"约数百至数千人","operatingRegions":["马里","尼日尔","布基纳法索"],"ideology":"在萨赫勒建立哈里发国","funding":"抢劫、绑架、外部捐助","fundingEstimate":"规模中等","designation":["美国指定外国恐怖组织","联合国制裁"],"weaponLevel":"轻武器+IED+伏击","cyberCapability":"低","description":"ISGS是伊斯兰国在萨赫勒地区的分支，以伏击军车和绑架人质著称。2017年导致4名美国士兵在尼日尔遇袭死亡。","structure":[{"role":"领导人","current":"阿布·瓦利德·萨赫拉维","desc":"创始人"},{"role":"战斗小组","current":"—","desc":"分散行动单元"}],"events":[{"date":"2017-10-04","title":"尼日尔伏击","desc":"伏击美军和尼日尔部队联合巡逻队","casualties":"4名美军和5名尼日尔士兵死亡","impact":"极高"},{"date":"2020-12","title":"尼日利亚村庄屠杀","desc":"袭击尼日尔村庄","casualties":"约100人死亡","impact":"高"}],"statements":[]},{"id":"adf","name":"民主同盟军","aliases":["ADF","Allied Democratic Forces","乌干达民主同盟军"],"type":"恐怖组织","category":"宗教极端","subcategory":"中非圣战武装","founded":"1995","foundedLocation":"乌干达西部","status":"活跃","threatLevel":7.5,"threatTrend":"上升","leader":"穆萨·巴拉卡萨","formerLeaders":["贾米尔·穆库卢"],"members":"约1,000-2,000人","operatingRegions":["刚果（金）东部","乌干达"],"ideology":"建立伊斯兰国家，推翻乌干达政府","funding":"走私、税收、外部捐助","fundingEstimate":"规模中等","designation":["联合国安理会制裁","美国指定外国恐怖组织","乌干达列禁"],"weaponLevel":"轻武器+IED+绑架","cyberCapability":"低","description":"ADF是乌干达叛军，后与ISIS结盟并宣誓效忠。活跃于刚果（金）东部，频繁发动袭击和绑架，造成大量平民伤亡。","structure":[{"role":"领导人","current":"穆萨·巴拉卡萨","desc":"最高指挥官"},{"role":"战斗小组","current":"—","desc":"分散单元"}],"events":[{"date":"2019-04","title":"卡辛迪袭击","desc":"在刚果（金）东部发动袭击","casualties":"约20人死亡","impact":"高"},{"date":"2021-06","title":"联合国车队遇袭","desc":"袭击维和部队车队","casualties":"1名意大利大使死亡","impact":"高"}],"statements":[]},{"id":"lra","name":"圣主抵抗军","aliases":["LRA","Lord's Resistance Army","上帝抵抗军"],"type":"恐怖组织","category":"宗教极端","subcategory":"中非极端武装","founded":"1987","foundedLocation":"乌干达北部","status":"潜伏活跃","threatLevel":6.5,"threatTrend":"下降","leader":"约瑟夫·科尼","formerLeaders":[],"members":"约100-500人","operatingRegions":["中非共和国","刚果（金）","南苏丹","苏丹"],"ideology":"以十诫为基础的圣灵运动，建立基于圣经律法的政权","funding":"走私、绑架、抢劫","fundingEstimate":"规模较小","designation":["美国指定外国恐怖组织","国际刑事法院通缉"],"weaponLevel":"轻武器","cyberCapability":"极低","description":"LRA是乌干达叛军，以绑架儿童、强迫其成为士兵和性奴而臭名昭著。约瑟夫·科尼被国际刑事法院通缉，但该组织仍在非洲中部活动。","structure":[{"role":"领导人","current":"约瑟夫·科尼","desc":"精神领袖与指挥官"},{"role":"高级指挥官","current":"—","desc":"分散小组"}],"events":[{"date":"2003-2004","title":"阿奇oli地区屠杀","desc":"大规模绑架儿童","casualties":"数万人被绑架","impact":"极端"},{"date":"2005","title":"国际刑事法院通缉","desc":"对科尼等发出逮捕令","casualties":"—","impact":"高"}],"statements":[]},{"id":"ansaru","name":"安萨尔","aliases":["Ansaru","Ansarul Muslimina Fi Biladis Sudan","尼日利亚安萨尔"],"type":"恐怖组织","category":"宗教极端","subcategory":"博科圣地分裂派系","founded":"2012","foundedLocation":"尼日利亚","status":"潜伏活跃","threatLevel":7,"threatTrend":"稳定","leader":"不详","formerLeaders":[],"members":"约数百人","operatingRegions":["尼日利亚","尼日尔","喀麦隆"],"ideology":"在尼日利亚北部建立伊斯兰国家，与博科圣地目标相似但反对滥杀穆斯林","funding":"绑架赎金、抢劫","fundingEstimate":"规模较小","designation":["美国指定外国恐怖组织","英国指定恐怖组织"],"weaponLevel":"轻武器+IED+绑架","cyberCapability":"低","description":"安萨尔是2012年从博科圣地分裂出来的组织，以绑架外国工人和袭击外国目标著称。其活动对尼日利亚北部中资企业构成安全威胁。","structure":[{"role":"领导人","current":"不详","desc":"多头目"},{"role":"行动小组","current":"—","desc":"分散单元"}],"events":[{"date":"2013-02","title":"法国家庭绑架","desc":"在喀麦隆绑架法国家庭","casualties":"全部获释","impact":"高"},{"date":"2013-08","title":"印度籍工人绑架","desc":"绑架并杀害多名印度建筑工人","casualties":"多人死亡","impact":"高"}],"statements":[]},{"id":"cjng","name":"哈利斯科新一代贩毒集团","aliases":["CJNG","Jalisco New Generation Cartel"],"type":"犯罪组织","category":"贩毒集团","subcategory":"墨西哥跨国犯罪组织","founded":"2009","foundedLocation":"墨西哥哈利斯科州","status":"活跃","threatLevel":8.5,"threatTrend":"上升","leader":"内梅西奥·奥塞格拉·塞万提斯（埃尔·门乔）","formerLeaders":[],"members":"数万人","operatingRegions":["墨西哥","美国","欧洲","亚洲"],"ideology":"无意识形态——商业利益驱动","funding":"毒品贩运（芬太尼、冰毒、可卡因）、武器走私、洗钱、人口贩卖","fundingEstimate":"年收入数十亿美元","designation":["美国财政部制裁","墨西哥政府重点打击目标"],"weaponLevel":"先进——自动武器、狙击步枪、无人机、装甲车","cyberCapability":"中——利用社交媒体炫耀暴力","description":"CJNG是墨西哥增长最快、最暴力的贩毒集团之一，与锡那罗亚集团争夺地盘。大量向美国走私芬太尼，是美国阿片类药物危机的主要推手之一。","structure":[{"role":"领导人","current":"埃尔·门乔","desc":"创始人与最高领袖"},{"role":"地方头目","current":"—","desc":"各州负责人"},{"role":"武装分支","current":"—","desc":"准军事力量"}],"events":[{"date":"2015-05-01","title":"哈利斯科扫毒行动","desc":"墨西哥军方打击CJNG引发大规模暴力","casualties":"数十人死亡","impact":"高"},{"date":"2020","title":"芬太尼危机高峰","desc":"美国芬太尼过量死亡激增","casualties":"数万人死亡","impact":"极端"},{"date":"2022-02","title":"美国悬赏","desc":"美国悬赏1500万美元抓捕埃尔·门乔","casualties":"—","impact":"高"}],"statements":[]},{"id":"gulf_cartel","name":"海湾贩毒集团","aliases":["Gulf Cartel","Cartel del Golfo","洛斯梅塔罗斯"],"type":"犯罪组织","category":"贩毒集团","subcategory":"墨西哥跨国犯罪组织","founded":"1930s","foundedLocation":"墨西哥塔毛利帕斯州","status":"活跃","threatLevel":7.5,"threatTrend":"稳定","leader":"多头目制","formerLeaders":["奥西埃尔·卡德纳斯·纪廉","安东尼奥·卡德纳斯·纪廉"],"members":"约1,000-5,000人","operatingRegions":["墨西哥东北部","美国南部"],"ideology":"无意识形态——商业利益驱动","funding":"毒品贩运、走私、敲诈","fundingEstimate":"年收入数亿美元","designation":["美国财政部制裁","墨西哥政府打击目标"],"weaponLevel":"自动武器+装甲车","cyberCapability":"低","description":"海湾贩毒集团是墨西哥历史最悠久的贩毒集团之一，曾培养洛斯塞塔斯为其武装翼。控制墨西哥东北部向美国的主要贩运走廊。","structure":[{"role":"领导人","current":"多头目","desc":"家族与派系共治"},{"role":"洛斯梅塔罗斯","current":"—","desc":"武装分支"}],"events":[{"date":"1999-2003","title":"洛斯塞塔斯成立","desc":"招募军方人员组建武装翼","casualties":"—","impact":"高"},{"date":"2010","title":"集团战争","desc":"与洛斯塞塔斯爆发血腥内战","casualties":"数千人死亡","impact":"极端"}],"statements":[]},{"id":"los_zetas","name":"洛斯塞塔斯","aliases":["Los Zetas","塞塔斯","墨西哥特种部队贩毒集团"],"type":"犯罪组织","category":"贩毒集团","subcategory":"墨西哥跨国犯罪组织","founded":"1997","foundedLocation":"墨西哥","status":"分裂衰落","threatLevel":7,"threatTrend":"下降","leader":"多头目","formerLeaders":["阿尔图罗·德古斯曼·戴塞纳（2002死亡）","米格尔·特雷维尼奥·莫拉莱斯（被捕）"],"members":"约数千人（鼎盛期过万）","operatingRegions":["墨西哥","美国","中美洲"],"ideology":"无意识形态——暴力控制地盘","funding":"毒品贩运、绑架、勒索、石油盗窃","fundingEstimate":"年收入数亿美元","designation":["美国财政部制裁","墨西哥政府打击目标"],"weaponLevel":"军用级武器、装甲车、火箭筒","cyberCapability":"低","description":"洛斯塞塔斯由墨西哥军队逃兵组建，曾是墨西哥最残忍的犯罪组织之一。以斩首、屠杀和军事化战术著称，现已分裂衰落。","structure":[{"role":"领导人","current":"多头目","desc":"分裂派系"},{"role":"军事化武装","current":"—","desc":"前特种部队人员"}],"events":[{"date":"2010","title":"圣费尔南多大屠杀","desc":"在塔毛利帕斯杀害72名中美洲移民","casualties":"72人死亡","impact":"极端"},{"date":"2011","title":"卡德雷塔赌场袭击","desc":"焚烧赌场造成52人死亡","casualties":"52人死亡","impact":"极端"},{"date":"2012","title":"领导人被捕","desc":"米格尔·特雷维尼奥被捕","casualties":"—","impact":"高"}],"statements":[]},{"id":"farc_d","name":"哥伦比亚革命武装力量（前成员）","aliases":["FARC dissidents","FARC Segunda Marquetalia","哥武残余"],"type":"犯罪组织","category":"贩毒集团","subcategory":"哥伦比亚武装组织","founded":"2016","foundedLocation":"哥伦比亚","status":"活跃","threatLevel":7,"threatTrend":"上升","leader":"伊万·马尔克斯（2022死亡）/ 卢西奥·里奥斯","formerLeaders":["伊万·马尔克斯"],"members":"约2,000-5,000人","operatingRegions":["哥伦比亚","委内瑞拉边境","厄瓜多尔"],"ideology":"马克思主义（名义），实际转向毒品经济","funding":"可卡因生产与贩运、敲诈勒索、非法采矿","fundingEstimate":"年收入数亿美元","designation":["美国指定外国恐怖组织（部分派系）","哥伦比亚政府打击目标"],"weaponLevel":"轻武器+地雷+爆炸物","cyberCapability":"低","description":"FARC残余是2016年和平协议后拒绝放下武器的哥武前成员组成的多个武装团体。主要从事可卡因生产和贩运，控制哥伦比亚部分地区。","structure":[{"role":"领导人","current":"卢西奥·里奥斯","desc":"第二马尔凯塔利亚领导人"},{"role":"地方派系","current":"—","desc":"分散多个武装团体"}],"events":[{"date":"2016","title":"和平协议签署","desc":"FARC与政府签署和平协议，部分成员拒绝遣散","casualties":"—","impact":"高"},{"date":"2021","title":"伊万·马尔克斯复出","desc":"前FARC高级领导人宣布重返武装斗争","casualties":"—","impact":"高"}],"statements":[]},{"id":"eln","name":"哥伦比亚民族解放军","aliases":["ELN","National Liberation Army","民族解放军"],"type":"犯罪组织","category":"民族武装","subcategory":"哥伦比亚左翼武装","founded":"1964","foundedLocation":"哥伦比亚","status":"活跃","threatLevel":7,"threatTrend":"稳定","leader":"安东尼奥·加西亚","formerLeaders":[],"members":"约2,000-5,000人","operatingRegions":["哥伦比亚","委内瑞拉边境","厄瓜多尔"],"ideology":"马克思主义、解放神学、反帝国主义","funding":"可卡因、敲诈勒索、非法采矿、绑架","fundingEstimate":"年收入数千万美元","designation":["美国指定外国恐怖组织","欧盟指定恐怖组织","哥伦比亚列禁"],"weaponLevel":"轻武器+地雷+爆炸物","cyberCapability":"低","description":"ELN是哥伦比亚现存最大的左翼游击组织，长期与政府冲突。近年来通过控制可卡因路线和委内瑞拉边境走私获利，频繁袭击石油基础设施。","structure":[{"role":"中央指挥部","current":"安东尼奥·加西亚","desc":"最高领导人"},{"role":"东方战线","current":"—","desc":"主要作战单位"}],"events":[{"date":"2019-01-17","title":"波哥大警察学院爆炸","desc":"汽车炸弹袭击警察学院","casualties":"22人死亡","impact":"高"},{"date":"2022","title":"绑架军人","desc":"绑架多名哥伦比亚军人","casualties":"—","impact":"高"}],"statements":[]},{"id":"agc","name":"海湾氏族","aliases":["AGC","Clan del Golfo","Gulf Clan","自治 gang"],"type":"犯罪组织","category":"贩毒集团","subcategory":"哥伦比亚有组织犯罪","founded":"2007","foundedLocation":"哥伦比亚安蒂奥基亚","status":"活跃","threatLevel":7.5,"threatTrend":"稳定","leader":"乔瓦尼·达里奥·阿里亚斯","formerLeaders":["丹尼尔·伦登·埃雷拉（被捕）","达里奥·安东尼奥·乌苏加（被捕）"],"members":"约1,500-3,000人","operatingRegions":["哥伦比亚","巴拿马","中美洲"],"ideology":"无意识形态——商业利益驱动","funding":"可卡因贩运、敲诈勒索、非法采矿","fundingEstimate":"年收入数亿美元","designation":["美国指定外国恐怖组织","哥伦比亚政府重点打击目标"],"weaponLevel":"轻武器+装甲车","cyberCapability":"低","description":"海湾氏族是哥伦比亚最大的有组织犯罪集团，由前右翼准军事组织演变而来。控制哥伦比亚大部分可卡因出口路线，对政府安全部队和平民发动频繁袭击。","structure":[{"role":"领导人","current":"乔瓦尼·阿里亚斯","desc":"现任最高头目"},{"role":"地方头目","current":"—","desc":"各地区负责人"}],"events":[{"date":"2022-05","title":"最大头目被捕","desc":"哥伦比亚抓获头目达里奥·乌苏加","casualties":"—","impact":"高"},{"date":"2022-07","title":"全国罢工威胁","desc":"该组织威胁杀害不遵守罢工令的人","casualties":"多人死亡","impact":"高"}],"statements":[]},{"id":"shining_path","name":"光辉道路（残余）","aliases":["Shining Path","Sendero Luminoso","秘鲁共产党"],"type":"犯罪组织","category":"民族武装","subcategory":"秘鲁左翼武装","founded":"1969","foundedLocation":"秘鲁阿亚库乔","status":"潜伏活跃","threatLevel":6,"threatTrend":"下降","leader":"阿维马埃尔·古斯曼（2021死亡）","formerLeaders":[],"members":"约100-300人","operatingRegions":["秘鲁阿普里马克-埃内-曼塔罗河谷"],"ideology":"毛主义，建立新民主主义人民共和国","funding":"毒品贸易、敲诈勒索","fundingEstimate":"规模较小","designation":["美国指定外国恐怖组织","秘鲁列禁"],"weaponLevel":"轻武器+地雷","cyberCapability":"极低","description":"光辉道路是秘鲁毛主义武装组织，1980-2000年代造成约7万人死亡。创始人古斯曼1992年被捕，2021年死亡。残余势力仍在秘鲁古柯产区活动。","structure":[{"role":"创始人","current":"阿维马埃尔·古斯曼","desc":"已故精神领袖"},{"role":"残余指挥","current":"—","desc":"分散小组"}],"events":[{"date":"1980","title":"发动武装斗争","desc":"开始针对秘鲁政府的游击战","casualties":"数十年间约7万人死亡","impact":"极端"},{"date":"1992","title":"古斯曼被捕","desc":"秘鲁安全部队抓获领导人","casualties":"—","impact":"极高"},{"date":"2021-09-11","title":"古斯曼死亡","desc":"在狱中死亡","casualties":"—","impact":"高"}],"statements":[]},{"id":"wagner","name":"瓦格纳集团","aliases":["Wagner Group","PMC Wagner","瓦格纳私人军事公司"],"type":"犯罪组织","category":"私人军事公司","subcategory":"俄罗斯雇佣兵组织","founded":"2014","foundedLocation":"俄罗斯","status":"重组中","threatLevel":7.5,"threatTrend":"稳定","leader":"叶夫根尼·普里戈任（2023死亡）","formerLeaders":["德米特里·乌特金（2023死亡）"],"members":"约数千至数万人","operatingRegions":["俄罗斯","乌克兰","叙利亚","利比亚","马里","中非共和国"],"ideology":"服务俄罗斯国家利益（名义），商业军事服务","funding":"俄罗斯国防部合同、矿产、商业活动","fundingEstimate":"年收入数亿美元","designation":["美国指定跨国犯罪组织","欧盟制裁","英国制裁"],"weaponLevel":"重武器+坦克+炮兵","cyberCapability":"中","description":"瓦格纳集团是俄罗斯私人军事公司，在乌克兰、叙利亚、非洲等多地活动。2023年创始人普里戈任发动兵变后坠机身亡，组织随后被俄罗斯收编重组。","structure":[{"role":"创始人","current":"叶夫根尼·普里戈任","desc":"已故"},{"role":"军事指挥官","current":"—","desc":"分散指挥"},{"role":"非洲分支","current":"—","desc":"在马里、中非等地活动"}],"events":[{"date":"2014","title":"克里米亚行动","desc":"参与俄罗斯吞并克里米亚","casualties":"—","impact":"高"},{"date":"2022-2023","title":"巴赫穆特战役","desc":"参与俄乌冲突巴赫穆特攻防战","casualties":"数万人伤亡","impact":"极高"},{"date":"2023-06-23","title":"瓦格纳兵变","desc":"向莫斯科进军后达成协议","casualties":"—","impact":"极高"},{"date":"2023-08-23","title":"普里戈任坠机身亡","desc":"领导人普里戈任在坠机中死亡","casualties":"10人死亡","impact":"高"}],"statements":[{"date":"2023-06-23","source":"普里戈任声明","content":"指责俄罗斯国防部对瓦格纳营地发动导弹袭击，宣布向莫斯科进军。"}]},{"id":"imu","name":"乌兹别克斯坦伊斯兰运动","aliases":["IMU","Islamic Movement of Uzbekistan","乌伊运"],"type":"恐怖组织","category":"宗教极端","subcategory":"中亚圣战组织","founded":"1991","foundedLocation":"乌兹别克斯坦/塔吉克斯坦","status":"被重创","threatLevel":6.5,"threatTrend":"下降","leader":"乌斯曼·加齐（2015死亡）","formerLeaders":["塔希尔·尤尔达舍夫（2009死亡）","朱马·纳曼加尼（2001死亡）"],"members":"约数百人","operatingRegions":["阿富汗","巴基斯坦","中亚"],"ideology":"在中亚建立伊斯兰国家","funding":"毒品贸易、绑架、外部捐助","fundingEstimate":"规模较小","designation":["联合国安理会制裁","美国指定外国恐怖组织","乌兹别克斯坦列禁"],"weaponLevel":"轻武器+IED","cyberCapability":"低","description":"IMU是1991年成立的中亚圣战组织，曾与塔利班和基地组织结盟。多数领导人在阿富汗-巴基斯坦边境被美军和巴军击毙，组织已严重削弱。","structure":[{"role":"埃米尔","current":"乌斯曼·加齐","desc":"末任领导人"},{"role":"军事指挥官","current":"—","desc":"残余势力"}],"events":[{"date":"1999","title":"吉尔吉斯斯坦袭击","desc":"袭击吉尔吉斯斯坦南部","casualties":"—","impact":"高"},{"date":"2001","title":"朱马·纳曼加尼死亡","desc":"在阿富汗军事行动中被打死","casualties":"—","impact":"高"},{"date":"2014","title":"宣布效忠ISIS","desc":"部分成员宣誓效忠伊斯兰国","casualties":"—","impact":"高"}],"statements":[]},{"id":"etlo","name":"东突厥斯坦解放组织","aliases":["ETLO","East Turkestan Liberation Organization","东突解放组织"],"type":"恐怖组织","category":"民族分离","subcategory":"新疆分裂武装","founded":"1996","foundedLocation":"土耳其","status":"潜伏","threatLevel":6,"threatTrend":"稳定","leader":"不详","formerLeaders":[],"members":"规模不详","operatingRegions":["土耳其","德国","中亚"],"ideology":"新疆独立，使用暴力手段","funding":"海外捐助、犯罪活动","fundingEstimate":"规模较小","designation":["中国公安部认定恐怖组织","联合国相关制裁"],"weaponLevel":"轻武器","cyberCapability":"低","description":"东突厥斯坦解放组织是被中国公安部认定的恐怖组织之一，以新疆独立为目标，曾在境外策划针对中国驻外机构的袭击。","structure":[{"role":"领导人","current":"不详","desc":"分散领导"},{"role":"海外网络","current":"—","desc":"欧洲与中亚活动"}],"events":[{"date":"1998","title":"伊斯坦布尔袭击图谋","desc":"涉嫌策划针对中国驻土耳其机构袭击","casualties":"—","impact":"中"}],"statements":[]}]};

/* ===== 评估结论存储 ===== */
const THREAT_ASSESS={
  _key:'orps_threat_assess',
  _data:null,
  _load(){if(this._data===null){try{this._data=JSON.parse(localStorage.getItem(this._key))||{}}catch(e){this._data={}}}},
  get(orgId){this._load();return this._data[orgId]||null},
  set(orgId,assess){this._load();this._data[orgId]=assess;localStorage.setItem(this._key,JSON.stringify(this._data))},
  remove(orgId){this._load();delete this._data[orgId];localStorage.setItem(this._key,JSON.stringify(this._data))},
  has(orgId){this._load();return!!this._data[orgId]},
  count(){this._load();return Object.keys(this._data).length}
};

/* ===== 自定义组织存储 ===== */
const THREAT_CUSTOM={
  _key:'orps_threat_custom',
  _data:null,
  _load(){if(this._data===null){try{this._data=JSON.parse(localStorage.getItem(this._key))||[]}catch(e){this._data=[]}}},
  getAll(){this._load();return this._data},
  get(id){this._load();return this._data.find(o=>o.id===id)||null},
  add(org){this._load();org.id='custom_'+Date.now();org.custom=true;this._data.push(org);localStorage.setItem(this._key,JSON.stringify(this._data));return org.id},
  update(id,org){this._load();const i=this._data.findIndex(o=>o.id===id);if(i>=0){this._data[i]={...this._data[i],...org};localStorage.setItem(this._key,JSON.stringify(this._data))}},
  remove(id){this._load();this._data=this._data.filter(o=>o.id!==id);localStorage.setItem(this._key,JSON.stringify(this._data))},
  count(){this._load();return this._data.length}
};

/* ===== 渲染逻辑 v2.0 ===== */
const THREATS={
  filterType:'all',filterCat:'all',filterRegion:'all',searchQuery:'',sortBy:'threatLevel',viewMode:'card',detailTab:'basic',selectedId:null,

  /* 合并静态数据和自定义数据 */
  get allOrgs(){return[...THREAT_DATA.organizations,...THREAT_CUSTOM.getAll()]},

  /* 筛选+排序 */
  get filtered(){
    let list=this.allOrgs.filter(o=>{
      if(this.filterType!=='all'&&o.type!==this.filterType)return false;
      if(this.filterCat!=='all'&&o.category!==this.filterCat)return false;
      if(this.filterRegion!=='all'&&!o.operatingRegions.includes(this.filterRegion))return false;
      if(this.searchQuery){
        const q=this.searchQuery.toLowerCase();
        const s=(o.name+(o.aliases||[]).join('')+(o.operatingRegions||[]).join('')+(o.leader||'')+o.category).toLowerCase();
        if(!s.includes(q))return false;
      }
      return true;
    });
    const sortMap={'threatLevel':(a,b)=>b.threatLevel-a.threatLevel,'name':(a,b)=>a.name.localeCompare(b.name),'events':(a,b)=>(b.events||[]).length-(a.events||[]).length,'founded':(a,b)=>(a.founded||'').localeCompare(b.founded||'')};
    list.sort(sortMap[this.sortBy]||sortMap.threatLevel);
    return list;
  },

  get allRegions(){const r=new Set();this.allOrgs.forEach(o=>(o.operatingRegions||[]).forEach(x=>r.add(x)));return[...r].sort()},

  threatColor(l){if(l>=9)return'#ff3355';if(l>=7.5)return'#ff5544';if(l>=6.5)return'#ff8800';if(l>=5.5)return'#ffcc00';return'#00ff9f'},
  threatLabel(l){if(l>=9)return'极高';if(l>=7.5)return'极高';if(l>=6.5)return'高';if(l>=5.5)return'中高';return'中'},
  threatBadge(l){const c=this.threatColor(l),t=this.threatLabel(l);return'<span class="badge" style="background:'+c+'22;color:'+c+';border:1px solid '+c+'55">'+t+' ('+l+')</span>'},
  impactBadge(i){const m={'极端':'b-red','高':'b-orange','中':'b-yellow'};return'<span class="badge '+(m[i]||'b-blue')+'">'+i+'</span>'},

  /* 系统数据关联 */
  _getLinkedEnterprises(o){
    if(typeof ENTERPRISES==='undefined')return[];
    return ENTERPRISES.filter(e=>(o.operatingRegions||[]).some(r=>e.countries.includes(r)));
  },
  _getLinkedAlerts(o){
    if(typeof ALERTS==='undefined')return[];
    return ALERTS.filter(a=>(o.operatingRegions||[]).includes(a.country));
  },
  _getLinkedEvents(o){
    if(typeof EVENTS==='undefined')return[];
    return EVENTS.filter(e=>(o.operatingRegions||[]).includes(e.country));
  },

  /* 主渲染 */
  render(){
    const c=document.getElementById('threatorgs-content');if(!c)return;
    var bc=document.getElementById('sb-threat-count');if(bc){bc.textContent=this.allOrgs.length;bc.classList.remove('zero');}
    const orgs=this.allOrgs;
    const terror=orgs.filter(o=>o.type==='恐怖组织').length;
    const crime=orgs.filter(o=>o.type==='犯罪组织').length;
    const active=orgs.filter(o=>(o.status||'').includes('活跃')||(o.status||'').includes('执政')).length;
    const avgT=(orgs.reduce((s,o)=>s+(o.threatLevel||5),0)/orgs.length).toFixed(1);
    const allEvents=orgs.reduce((s,o)=>s+(o.events||[]).length,0);
    const allStatements=orgs.reduce((s,o)=>s+(o.statements||[]).length,0);
    const assessed=THREAT_ASSESS.count();

    c.innerHTML=`
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-ic" style="background:rgba(255,51,85,0.12);color:var(--red)">🎯</div><div class="stat-info"><div class="stat-label">威胁组织总数</div><div class="stat-val" style="color:var(--red)">${orgs.length}</div><div class="stat-sub">恐怖 ${terror} · 犯罪 ${crime} · 自定义 ${THREAT_CUSTOM.count()}</div></div></div>
      <div class="stat-card"><div class="stat-ic" style="background:rgba(255,136,0,0.12);color:var(--orange)">⚡</div><div class="stat-info"><div class="stat-label">活跃威胁</div><div class="stat-val" style="color:var(--orange)">${active}</div><div class="stat-sub">当前正在活动</div></div></div>
      <div class="stat-card"><div class="stat-ic" style="background:rgba(0,212,255,0.12);color:var(--cyan)">📊</div><div class="stat-info"><div class="stat-label">平均威胁指数</div><div class="stat-val" style="color:var(--cyan)">${avgT}</div><div class="stat-sub">满分10.0</div></div></div>
      <div class="stat-card"><div class="stat-ic" style="background:rgba(179,102,255,0.12);color:var(--purple)">📝</div><div class="stat-info"><div class="stat-label">已评估组织</div><div class="stat-val" style="color:var(--purple)">${assessed}</div><div class="stat-sub">含评估结论</div></div></div>
      <div class="stat-card"><div class="stat-ic" style="background:rgba(0,255,159,0.12);color:var(--green)">🌍</div><div class="stat-info"><div class="stat-label">覆盖国家/地区</div><div class="stat-val" style="color:var(--green)">${this.allRegions.length}</div><div class="stat-sub">全球分布</div></div></div>
      <div class="stat-card"><div class="stat-ic" style="background:rgba(255,204,0,0.12);color:var(--yellow)">💣</div><div class="stat-info"><div class="stat-label">恐怖/犯罪事件</div><div class="stat-val" style="color:var(--yellow)">${allEvents}</div><div class="stat-sub">已记录重大事件</div></div></div>
    </div>

    <div class="card">
      <div class="card-tt"><span class="ic">🎯</span>威胁组织数据库 <span style="font-size:10px;color:var(--text3);font-weight:400;margin-left:6px">— 交互式情报档案 · 支持自定义组织和评估结论</span>
        <button class="btn btn-sm" style="margin-left:auto;font-size:11px;padding:4px 12px" onclick="THREATS.showOrgForm(null)">+ 新增组织</button>
      </div>
      <div class="flex gap-8 mb-12 wrap items-center">
        <div class="chip ${this.filterType==='all'?'active':''}" onclick="THREATS.setFilter('type','all')">全部</div>
        <div class="chip ${this.filterType==='恐怖组织'?'active':''}" onclick="THREATS.setFilter('type','恐怖组织')">恐怖组织</div>
        <div class="chip ${this.filterType==='犯罪组织'?'active':''}" onclick="THREATS.setFilter('type','犯罪组织')">犯罪组织</div>
        <div style="width:1px;height:20px;background:var(--border);margin:0 4px"></div>
        <div class="chip ${this.filterCat==='all'?'active':''}" onclick="THREATS.setFilter('cat','all')">全部分类</div>
        <div class="chip ${this.filterCat==='宗教极端'?'active':''}" onclick="THREATS.setFilter('cat','宗教极端')">宗教极端</div>
        <div class="chip ${this.filterCat==='贩毒集团'?'active':''}" onclick="THREATS.setFilter('cat','贩毒集团')">贩毒集团</div>
        <div class="chip ${this.filterCat==='黑社会组织'?'active':''}" onclick="THREATS.setFilter('cat','黑社会组织')">黑社会组织</div>
        <div style="width:1px;height:20px;background:var(--border);margin:0 4px"></div>
        <select class="input" style="width:130px;font-size:11px;padding:4px 8px" onchange="THREATS.filterRegion=this.value;THREATS.renderGrid()">
          <option value="all">全部地区</option>
          ${this.allRegions.map(r=>'<option value="'+r+'" '+(this.filterRegion===r?'selected':'')+'>'+r+'</option>').join('')}
        </select>
        <input class="input" placeholder="🔍 搜索组织名称、别名、地区..." style="width:200px;margin-left:auto" value="${this.searchQuery}" oninput="THREATS.searchQuery=this.value;THREATS.renderGrid()">
        <div style="display:flex;gap:0;border:1px solid var(--border);border-radius:6px;overflow:hidden">
          <button style="padding:4px 10px;font-size:11px;border:none;background:${this.viewMode==='card'?'var(--cyan)':'var(--panel)'};color:${this.viewMode==='card'?'#fff':'var(--text2)'};cursor:pointer" onclick="THREATS.viewMode='card';THREATS.renderGrid();THREATS.render()">卡片</button>
          <button style="padding:4px 10px;font-size:11px;border:none;background:${this.viewMode==='table'?'var(--cyan)':'var(--panel)'};color:${this.viewMode==='table'?'#fff':'var(--text2)'};cursor:pointer" onclick="THREATS.viewMode='table';THREATS.renderGrid();THREATS.render()">表格</button>
        </div>
        <select class="input" style="width:100px;font-size:11px;padding:4px 8px" onchange="THREATS.sortBy=this.value;THREATS.renderGrid()">
          <option value="threatLevel" ${this.sortBy==='threatLevel'?'selected':''}>威胁指数</option>
          <option value="name" ${this.sortBy==='name'?'selected':''}>名称</option>
          <option value="events" ${this.sortBy==='events'?'selected':''}>事件数</option>
          <option value="founded" ${this.sortBy==='founded'?'selected':''}>成立时间</option>
        </select>
      </div>
      <div id="threat-grid"></div>
    </div>`;
    this.renderGrid();
  },

  renderGrid(){
    const el=document.getElementById('threat-grid');if(!el)return;
    const orgs=this.filtered;
    if(!orgs.length){el.innerHTML='<div class="empty"><div class="ic">🔍</div><div>未找到匹配的组织</div></div>';return}
    if(this.viewMode==='table')el.innerHTML=this._renderTable(orgs);
    else el.innerHTML=this._renderCards(orgs);
  },

  _renderCards(orgs){
    return '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px">'+orgs.map(o=>{
      const tc=this.threatColor(o.threatLevel||5);
      const linkedEnts=this._getLinkedEnterprises(o);
      const hasAssess=THREAT_ASSESS.has(o.id);
      return '<div class="threat-org-card" style="background:var(--panel);border:1px solid var(--border);border-left:4px solid '+tc+';border-radius:10px;padding:14px;cursor:pointer;transition:.2s" onclick="THREATS.showDetail(\''+o.id+'\')">'+
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:8px">'+
          '<div><div style="font-size:15px;font-weight:700;color:var(--text)">'+(o.name||'')+(o.custom?' <span style="font-size:9px;color:var(--purple);background:rgba(179,102,255,0.12);padding:1px 5px;border-radius:3px">自定义</span>':'')+'</div>'+
          '<div style="font-size:10px;color:var(--text3);margin-top:2px">'+((o.aliases||[]).slice(0,3).join(' · ')||'')+'</div></div>'+
          this.threatBadge(o.threatLevel||5)+
        '</div>'+
        '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">'+
          '<span class="badge '+(o.type==='恐怖组织'?'b-red':'b-purple')+'">'+(o.type||'')+'</span>'+
          '<span class="badge b-blue">'+(o.category||'')+'</span>'+
          '<span class="badge '+((o.status||'').includes('活跃')?'b-orange':(o.status||'').includes('执政')?'b-red':'b-green')+'">'+(o.status||'')+'</span>'+
          (hasAssess?'<span class="badge b-green">已评估</span>':'')+
        '</div>'+
        '<div style="font-size:11px;color:var(--text2);line-height:1.5;margin-bottom:8px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">'+(o.description||'')+'</div>'+
        (linkedEnts.length?'<div style="font-size:10px;color:var(--cyan);margin-bottom:6px">🔗 关联中资企业 '+linkedEnts.length+' 家: '+linkedEnts.slice(0,3).map(e=>e.short).join('、')+(linkedEnts.length>3?'等':'')+'</div>':'')+
        '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text3);border-top:1px solid var(--border);padding-top:8px">'+
          '<span>📅 '+(o.founded||'—')+'</span>'+
          '<span>👤 '+(o.members||'—')+'</span>'+
          '<span>🌍 '+((o.operatingRegions||[]).length)+'地区</span>'+
          '<span>💣 '+((o.events||[]).length)+'事件</span>'+
        '</div>'+
      '</div>';
    }).join('')+'</div>';
  },

  _renderTable(orgs){
    return '<div style="overflow-x:auto"><table class="data-table" style="width:100%;font-size:11px;border-collapse:collapse">'+
      '<thead><tr style="background:var(--panel2);text-align:left">'+
        '<th style="padding:8px 10px;border-bottom:2px solid var(--border)">组织名称</th>'+
        '<th style="padding:8px 10px;border-bottom:2px solid var(--border)">类型</th>'+
        '<th style="padding:8px 10px;border-bottom:2px solid var(--border)">威胁指数</th>'+
        '<th style="padding:8px 10px;border-bottom:2px solid var(--border)">状态</th>'+
        '<th style="padding:8px 10px;border-bottom:2px solid var(--border)">活动区域</th>'+
        '<th style="padding:8px 10px;border-bottom:2px solid var(--border)">关联企业</th>'+
        '<th style="padding:8px 10px;border-bottom:2px solid var(--border)">评估</th>'+
        '<th style="padding:8px 10px;border-bottom:2px solid var(--border)">操作</th>'+
      '</tr></thead><tbody>'+
      orgs.map(o=>{
        const tc=this.threatColor(o.threatLevel||5);
        const linkedEnts=this._getLinkedEnterprises(o);
        const hasAssess=THREAT_ASSESS.has(o.id);
        return '<tr style="border-bottom:1px solid var(--border);cursor:pointer" onclick="THREATS.showDetail(\''+o.id+'\')">'+
          '<td style="padding:8px 10px;color:var(--text);font-weight:600">'+(o.name||'')+(o.custom?' <span style="font-size:9px;color:var(--purple)">[自定义]</span>':'')+'</td>'+
          '<td style="padding:8px 10px"><span class="badge '+(o.type==='恐怖组织'?'b-red':'b-purple')+'" style="font-size:10px">'+(o.type||'')+'</span></td>'+
          '<td style="padding:8px 10px"><span style="color:'+tc+';font-weight:700">'+(o.threatLevel||5)+'</span></td>'+
          '<td style="padding:8px 10px"><span class="badge '+((o.status||'').includes('活跃')?'b-orange':(o.status||'').includes('执政')?'b-red':'b-green')+'" style="font-size:10px">'+(o.status||'')+'</span></td>'+
          '<td style="padding:8px 10px;color:var(--text2);font-size:10px">'+((o.operatingRegions||[]).slice(0,3).join('、')||'—')+'</td>'+
          '<td style="padding:8px 10px;color:var(--cyan);font-size:10px">'+(linkedEnts.length?linkedEnts.length+'家':'—')+'</td>'+
          '<td style="padding:8px 10px">'+(hasAssess?'<span class="badge b-green" style="font-size:10px">已评估</span>':'<span class="badge" style="font-size:10px;background:var(--bg);color:var(--text3)">未评估</span>')+'</td>'+
          '<td style="padding:8px 10px" onclick="event.stopPropagation()">'+
            '<button class="btn btn-sm" style="font-size:10px;padding:2px 8px;margin-right:4px" onclick="THREATS.showDetail(\''+o.id+'\')">详情</button>'+
            (o.custom?'<button class="btn btn-sm" style="font-size:10px;padding:2px 8px;color:var(--red)" onclick="THREATS.deleteOrg(\''+o.id+'\')">删除</button>':'')+
          '</td>'+
        '</tr>';
      }).join('')+
      '</tbody></table></div>';
  },

  setFilter(dim,val){
    if(dim==='type')this.filterType=val;
    if(dim==='cat')this.filterCat=val;
    this.render();
  },

  /* 查找组织（静态+自定义） */
  findOrg(id){return this.allOrgs.find(x=>x.id===id)},

  showDetail(id){
    const o=this.findOrg(id);if(!o)return;
    this.selectedId=id;this.detailTab='basic';
    const modal=document.getElementById('modal');
    document.getElementById('modal-tt').innerHTML='🎯 '+o.name+' <span style="font-size:12px;color:var(--text2);font-weight:400">'+((o.aliases||[]).join(' / ')||'')+'</span>';
    document.getElementById('modal-bd').innerHTML=this.renderDetail(o);
    modal.classList.add('show');
    const box=modal.querySelector('.modal-box');
    box.style.maxWidth='920px';
  },

  renderDetail(o){
    const tc=this.threatColor(o.threatLevel||5);
    return ''+
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">'+
      this.threatBadge(o.threatLevel||5)+
      '<span class="badge '+(o.type==='恐怖组织'?'b-red':'b-purple')+'">'+(o.type||'')+'</span>'+
      '<span class="badge b-blue">'+(o.category||'')+'</span>'+
      '<span class="badge '+((o.status||'').includes('活跃')?'b-orange':(o.status||'').includes('执政')?'b-red':'b-green')+'">'+(o.status||'')+'</span>'+
      '<span class="badge b-yellow">趋势: '+(o.threatTrend||'—')+'</span>'+
      (o.custom?'<span class="badge b-purple">自定义组织</span>':'')+
    '</div>'+
    '<div style="display:flex;gap:6px;margin-bottom:14px">'+
      (typeof AIREPORT!=='undefined'?'<button class="btn btn-sm" style="font-size:11px;padding:4px 12px" onclick="AIREPORT.addThreatMaterial(\''+o.id+'\')">📄 加入情报分析</button>':'')+
      '<button class="btn btn-sm" style="font-size:11px;padding:4px 12px" onclick="THREATS.showAssessForm(\''+o.id+'\')">📝 '+(THREAT_ASSESS.has(o.id)?'修改评估':'添加评估')+'</button>'+
      (o.custom?'<button class="btn btn-sm" style="font-size:11px;padding:4px 12px" onclick="THREATS.showOrgForm(\''+o.id+'\')">✏️ 编辑组织</button>':'')+
    '</div>'+
    '<div class="dc-tabs" style="margin-bottom:14px">'+
      '<div class="dc-tab '+(this.detailTab==='basic'?'active':'')+'" onclick="THREATS.switchTab(\'basic\')">📋 基本情况</div>'+
      '<div class="dc-tab '+(this.detailTab==='structure'?'active':'')+'" onclick="THREATS.switchTab(\'structure\')">🏗️ 组织架构</div>'+
      '<div class="dc-tab '+(this.detailTab==='events'?'active':'')+'" onclick="THREATS.switchTab(\'events\')">💣 恐怖事件</div>'+
      '<div class="dc-tab '+(this.detailTab==='statements'?'active':'')+'" onclick="THREATS.switchTab(\'statements\')">📢 对外言论</div>'+
      '<div class="dc-tab '+(this.detailTab==='assess'?'active':'')+'" onclick="THREATS.switchTab(\'assess\')">📊 威胁评估</div>'+
      '<div class="dc-tab '+(this.detailTab==='conclusion'?'active':'')+'" onclick="THREATS.switchTab(\'conclusion\')">📝 结论研判</div>'+
      '<div class="dc-tab '+(this.detailTab==='linked'?'active':'')+'" onclick="THREATS.switchTab(\'linked\')">🔗 系统关联</div>'+
    '</div>'+
    '<div id="threat-detail-content">'+this.renderTab(o)+'</div>';
  },

  switchTab(tab){
    this.detailTab=tab;
    const o=this.findOrg(this.selectedId);if(!o)return;
    const el=document.getElementById('threat-detail-content');
    if(el)el.innerHTML=this.renderTab(o);
    document.querySelectorAll('#modal .dc-tab').forEach((t,i)=>{
      const tabs=['basic','structure','events','statements','assess','conclusion','linked'];
      t.classList.toggle('active',tabs[i]===tab);
    });
  },

  renderTab(o){
    switch(this.detailTab){
      case'basic':return this.tabBasic(o);
      case'structure':return this.tabStructure(o);
      case'events':return this.tabEvents(o);
      case'statements':return this.tabStatements(o);
      case'assess':return this.tabAssess(o);
      case'conclusion':return this.tabConclusion(o);
      case'linked':return this.tabLinked(o);
      default:return'';
    }
  },

  tabBasic(o){
    const row=(label,val)=>'<div style="display:flex;padding:6px 0;border-bottom:1px solid var(--border)"><div style="width:110px;flex-shrink:0;color:var(--text2);font-size:11px">'+label+'</div><div style="flex:1;font-size:12px;color:var(--text)">'+(val||'—')+'</div></div>';
    return '<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:12px;font-size:12px;line-height:1.7;color:var(--text2)">'+(o.description||'')+'</div>'+
    '<div style="background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:12px 16px">'+
      row('组织名称',o.name)+
      row('别名/曾用名',(o.aliases||[]).join('、'))+
      row('组织类型','<span class="badge '+(o.type==='恐怖组织'?'b-red':'b-purple')+'">'+(o.type||'')+'</span>')+
      row('主要分类',o.category)+
      row('细分类型',o.subcategory)+
      row('成立时间',o.founded)+
      row('成立地点',o.foundedLocation)+
      row('当前状态','<span class="badge '+((o.status||'').includes('活跃')?'b-orange':(o.status||'').includes('执政')?'b-red':'b-green')+'">'+(o.status||'')+'</span>')+
      row('现任领导人',o.leader)+
      row('前任领导人',(o.formerLeaders||[]).join('<br>'))+
      row('成员规模',o.members)+
      row('活动区域','<div style="display:flex;gap:4px;flex-wrap:wrap">'+(o.operatingRegions||[]).map(r=>'<span class="badge b-blue">'+r+'</span>').join('')+'</div>')+
      row('意识形态',o.ideology)+
      row('资金来源',o.funding)+
      row('资金规模',o.fundingEstimate)+
      row('武器水平',o.weaponLevel)+
      row('网络能力',o.cyberCapability)+
      row('国际认定','<div style="display:flex;gap:4px;flex-wrap:wrap">'+(o.designation||[]).map(d=>'<span class="badge b-red">'+d+'</span>').join('')+'</div>')+
    '</div>';
  },

  tabStructure(o){
    if(!o.structure||!o.structure.length)return'<div class="empty"><div class="ic">📋</div><div>暂无组织架构数据</div></div>';
    return '<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:12px;font-size:12px;line-height:1.7;color:var(--text2)">'+
      (o.name||'')+'的组织架构采用层级分明的管理体系，各层级职责明确。以下是该组织的核心架构与职责分工：'+
    '</div>'+
    '<div class="timeline-container">'+
      o.structure.map((s,i)=>{
        const colors=['var(--red)','var(--orange)','var(--yellow)','var(--cyan)','var(--green)','var(--purple)','var(--cyan)','var(--green)','var(--purple)'];
        const c=colors[i%colors.length];
        return '<div class="timeline-item">'+
          '<div class="timeline-dot" style="background:'+c+';color:'+c+'"></div>'+
          '<div class="timeline-content" style="border-left:3px solid '+c+'">'+
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">'+
              '<div style="font-size:13px;font-weight:700;color:'+c+'">'+s.role+'</div>'+
              '<span style="font-size:10px;color:var(--text3)">层级 '+(i+1)+'</span>'+
            '</div>'+
            '<div style="font-size:12px;color:var(--text);margin-bottom:3px">现任：'+s.current+'</div>'+
            '<div style="font-size:11px;color:var(--text2)">'+s.desc+'</div>'+
          '</div>'+
        '</div>';
      }).join('')+
    '</div>';
  },

  tabEvents(o){
    if(!o.events||!o.events.length)return'<div class="empty"><div class="ic">📋</div><div>暂无事件数据</div></div>';
    return '<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:12px;font-size:12px;line-height:1.7;color:var(--text2)">'+
      (o.name||'')+'已记录重大事件 <span style="color:var(--cyan);font-weight:700">'+o.events.length+'</span> 起，按时间线排列如下：'+
    '</div>'+
    '<div class="timeline-container">'+
      o.events.map((e,i)=>{
        const ic=e.impact==='极端'?'var(--red)':e.impact==='高'?'var(--orange)':'var(--yellow)';
        return '<div class="timeline-item">'+
          '<div class="timeline-dot" style="background:'+ic+';color:'+ic+'"></div>'+
          '<div class="timeline-content" style="border-left:3px solid '+ic+'">'+
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">'+
              '<div style="font-size:13px;font-weight:700;color:var(--text)">'+e.title+'</div>'+
              '<div style="display:flex;gap:4px"><span style="font-size:10px;color:var(--text3);font-family:Courier New,monospace">'+e.date+'</span>'+this.impactBadge(e.impact)+'</div>'+
            '</div>'+
            '<div style="font-size:12px;color:var(--text2);line-height:1.5;margin-bottom:4px">'+e.desc+'</div>'+
            (e.casualties&&e.casualties!=='—'?'<div style="font-size:11px;color:var(--red);margin-top:4px">☠️ 伤亡：'+e.casualties+'</div>':'')+
          '</div>'+
        '</div>';
      }).join('')+
    '</div>';
  },

  tabStatements(o){
    if(!o.statements||!o.statements.length)return'<div class="empty"><div class="ic">📋</div><div>暂无言论数据</div></div>';
    return '<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:12px;font-size:12px;line-height:1.7;color:var(--text2)">'+
      (o.name||'')+'的对外言论/声明记录 <span style="color:var(--cyan);font-weight:700">'+o.statements.length+'</span> 条。'+
    '</div>'+
    '<div style="display:flex;flex-direction:column;gap:10px">'+
      o.statements.map((s,i)=>{
        return '<div style="background:var(--panel2);border:1px solid var(--border);border-left:3px solid var(--cyan);border-radius:8px;padding:12px 14px">'+
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'+
            '<div style="display:flex;align-items:center;gap:8px">'+
              '<div style="width:28px;height:28px;border-radius:6px;background:rgba(0,212,255,0.12);display:flex;align-items:center;justify-content:center;font-size:14px">📢</div>'+
              '<div><div style="font-size:12px;font-weight:600;color:var(--cyan)">'+s.source+'</div>'+
              '<div style="font-size:10px;color:var(--text3);font-family:Courier New,monospace">'+s.date+'</div></div>'+
            '</div>'+
            '<span style="font-size:10px;color:var(--text3)">声明 #'+String(i+1).padStart(2,'0')+'</span>'+
          '</div>'+
          '<div style="font-size:12px;color:var(--text);line-height:1.7;background:var(--bg);padding:10px 14px;border-radius:6px;border:1px solid var(--border)">"'+s.content+'"</div>'+
        '</div>';
      }).join('')+
    '</div>';
  },

  tabAssess(o){
    const tl=o.threatLevel||5;
    const metrics=[
      {label:'意识形态影响力',val:Math.min(10,tl+0.5),desc:'极端思想传播与招募能力'},
      {label:'军事/行动能力',val:tl,desc:'武装力量与作战能力'},
      {label:'资金实力',val:Math.min(10,tl-1),desc:'资金获取与运作规模'},
      {label:'组织凝聚力',val:Math.min(10,tl+1),desc:'内部团结与执行力'},
      {label:'国际威胁度',val:tl,desc:'对国际安全的威胁程度'},
      {label:'网络/宣传能力',val:Math.min(10,tl-2),desc:'网络宣传与社交媒体运用'}
    ];
    const regions=(o.operatingRegions||[]).map(r=>({name:r,threat:tl*(0.7+Math.random()*0.3)}));
    return '<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:12px;font-size:12px;line-height:1.7;color:var(--text2)">'+
      '综合威胁评估指数：<span style="font-size:18px;font-weight:800;color:'+this.threatColor(tl)+'">'+tl+'</span>/10.0 — <span style="color:'+this.threatColor(tl)+';font-weight:600">'+this.threatLabel(tl)+'</span>'+
    '</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">'+
      '<div style="background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:14px">'+
        '<div style="font-size:13px;font-weight:700;color:var(--cyan);margin-bottom:12px">📈 威胁能力评估</div>'+
        metrics.map(m=>{
          const pct=m.val*10;const c=this.threatColor(m.val);
          return '<div style="margin-bottom:10px">'+
            '<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:11px;color:var(--text2)">'+m.label+'</span><span style="font-size:11px;font-weight:700;color:'+c+'">'+m.val.toFixed(1)+'</span></div>'+
            '<div class="risk-bar" style="width:100%;background:var(--bg)"><div class="risk-bar-fill" style="width:'+pct+'%;background:'+c+'"></div></div>'+
            '<div style="font-size:9px;color:var(--text3);margin-top:2px">'+m.desc+'</div>'+
          '</div>';
        }).join('')+
      '</div>'+
      '<div style="background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:14px">'+
        '<div style="font-size:13px;font-weight:700;color:var(--cyan);margin-bottom:12px">🌍 活动区域威胁分布</div>'+
        regions.map(r=>{
          const c=this.threatColor(r.threat);
          return '<div style="margin-bottom:8px">'+
            '<div style="display:flex;justify-content:space-between;margin-bottom:3px"><span style="font-size:11px;color:var(--text2)">'+r.name+'</span><span style="font-size:11px;font-weight:700;color:'+c+'">'+r.threat.toFixed(1)+'</span></div>'+
            '<div class="risk-bar" style="width:100%;background:var(--bg)"><div class="risk-bar-fill" style="width:'+r.threat*10+'%;background:'+c+'"></div></div>'+
          '</div>';
        }).join('')+
        '<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border);font-size:11px;color:var(--text2);line-height:1.6">'+
          '<div style="font-weight:600;color:var(--cyan);margin-bottom:4px">📌 评估摘要</div>'+
          '资金规模：'+(o.fundingEstimate||'—')+'<br>'+
          '武器水平：'+(o.weaponLevel||'—')+'<br>'+
          '网络能力：'+(o.cyberCapability||'—')+'<br>'+
          '威胁趋势：<span style="color:'+(o.threatTrend==='上升'?'var(--red)':o.threatTrend==='下降'?'var(--green)':'var(--yellow)')+'">'+(o.threatTrend||'—')+'</span>'+
        '</div>'+
      '</div>'+
    '</div>'+
    '<div style="background:var(--red-bg);border:1px solid rgba(255,51,85,0.2);border-radius:8px;padding:14px;margin-top:12px">'+
      '<div style="font-size:13px;font-weight:700;color:var(--red);margin-bottom:8px">⚠️ 国际认定情况</div>'+
      '<div style="display:flex;gap:6px;flex-wrap:wrap">'+(o.designation||[]).map(d=>'<span class="badge b-red">'+d+'</span>').join('')+'</div>'+
    '</div>';
  },

  /* ===== 结论研判标签页 ===== */
  tabConclusion(o){
    const a=THREAT_ASSESS.get(o.id);
    if(!a){
      return '<div class="empty" style="padding:40px"><div class="ic" style="font-size:48px">📝</div>'+
        '<div style="font-size:14px;color:var(--text2);margin:12px 0">暂无评估结论</div>'+
        '<div style="font-size:11px;color:var(--text3);margin-bottom:16px">为该威胁组织添加评估结论，包括威胁指数、评估人、风险研判和处置建议。</div>'+
        '<button class="btn" style="font-size:12px;padding:6px 20px" onclick="THREATS.showAssessForm(\''+o.id+'\')">+ 添加评估结论</button>'+
      '</div>';
    }
    const tc=this.threatColor(a.threatIndex||o.threatLevel||5);
    return '<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:12px">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">'+
        '<div style="font-size:13px;font-weight:700;color:var(--cyan)">📝 评估结论 — '+(o.name||'')+'</div>'+
        '<div style="display:flex;gap:6px">'+
          '<button class="btn btn-sm" style="font-size:11px;padding:4px 12px" onclick="THREATS.showAssessForm(\''+o.id+'\')">✏️ 修改</button>'+
          '<button class="btn btn-sm" style="font-size:11px;padding:4px 12px;color:var(--red)" onclick="THREATS.deleteAssess(\''+o.id+'\')">🗑️ 删除</button>'+
        '</div>'+
      '</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">'+
        '<div style="background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:12px">'+
          '<div style="font-size:10px;color:var(--text3);margin-bottom:4px">评估威胁指数</div>'+
          '<div style="font-size:24px;font-weight:800;color:'+tc+'">'+(a.threatIndex||o.threatLevel||5)+'</div>'+
          '<div style="font-size:11px;color:'+tc+'">'+this.threatLabel(a.threatIndex||o.threatLevel||5)+'</div>'+
        '</div>'+
        '<div style="background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:12px">'+
          '<div style="font-size:10px;color:var(--text3);margin-bottom:4px">评估人</div>'+
          '<div style="font-size:14px;font-weight:600;color:var(--text)">'+(a.assessor||'—')+'</div>'+
          '<div style="font-size:10px;color:var(--text3);margin-top:4px">'+(a.date||'—')+'</div>'+
        '</div>'+
      '</div>'+
      '<div style="background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:10px">'+
        '<div style="font-size:12px;font-weight:700;color:var(--cyan);margin-bottom:8px">📋 评估结论</div>'+
        '<div style="font-size:12px;color:var(--text);line-height:1.7">'+(a.conclusion||'—')+'</div>'+
      '</div>'+
      '<div style="background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:10px">'+
        '<div style="font-size:12px;font-weight:700;color:var(--orange);margin-bottom:8px">⚠️ 风险研判</div>'+
        '<div style="font-size:12px;color:var(--text);line-height:1.7">'+(a.riskAnalysis||'—')+'</div>'+
      '</div>'+
      '<div style="background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:14px">'+
        '<div style="font-size:12px;font-weight:700;color:var(--green);margin-bottom:8px">💡 处置建议</div>'+
        '<div style="font-size:12px;color:var(--text);line-height:1.7">'+(a.recommendation||'—')+'</div>'+
      '</div>'+
    '</div>';
  },

  /* ===== 系统关联标签页 ===== */
  tabLinked(o){
    const ents=this._getLinkedEnterprises(o);
    const alerts=this._getLinkedAlerts(o);
    const events=this._getLinkedEvents(o);
    return '<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:12px;font-size:12px;line-height:1.7;color:var(--text2)">'+
      (o.name||'')+'活动区域覆盖 '+(o.operatingRegions||[]).length+' 个国家/地区，与系统中 '+ents.length+' 家中资企业、'+alerts.length+' 条预警、'+events.length+' 个事件存在关联。'+
    '</div>'+

    '<div style="background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:12px">'+
      '<div style="font-size:13px;font-weight:700;color:var(--cyan);margin-bottom:10px">🏢 关联中资企业 ('+ents.length+')</div>'+
      (ents.length?
        '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px">'+
        ents.map(e=>
          '<div style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:10px">'+
            '<div style="font-size:12px;font-weight:600;color:var(--text)">'+(e.short||e.name)+'</div>'+
            '<div style="font-size:10px;color:var(--text3);margin-top:2px">'+(e.industry||'')+'</div>'+
            '<div style="font-size:10px;color:var(--cyan);margin-top:4px">投资 '+(e.investment||0)+'亿美元 · '+(e.personnel||0)+'人</div>'+
            '<div style="display:flex;gap:3px;flex-wrap:wrap;margin-top:4px">'+
              (o.operatingRegions||[]).filter(r=>e.countries.includes(r)).map(r=>'<span class="badge b-blue" style="font-size:9px;padding:1px 5px">'+r+'</span>').join('')+
            '</div>'+
          '</div>'
        ).join('')+
        '</div>'
      :'<div style="font-size:11px;color:var(--text3)">暂无关联中资企业</div>')+
    '</div>'+

    '<div style="background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:12px">'+
      '<div style="font-size:13px;font-weight:700;color:var(--red);margin-bottom:10px">🚨 关联预警 ('+alerts.length+')</div>'+
      (alerts.length?
        '<div style="display:flex;flex-direction:column;gap:8px">'+
        alerts.map(a=>
          '<div style="background:var(--bg);border:1px solid var(--border);border-left:3px solid '+(a.level==='red'?'var(--red)':a.level==='orange'?'var(--orange)':'var(--yellow')+';border-radius:6px;padding:10px">'+
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">'+
              '<div style="font-size:12px;font-weight:600;color:var(--text)">'+a.title+'</div>'+
              '<span class="badge '+(a.level==='red'?'b-red':a.level==='orange'?'b-orange':'b-yellow')+'" style="font-size:9px">'+a.level+'</span>'+
            '</div>'+
            '<div style="font-size:10px;color:var(--text3);margin-bottom:3px">'+a.time+' · '+a.country+' · '+a.enterprise+'</div>'+
            '<div style="font-size:11px;color:var(--text2);line-height:1.5">'+a.desc+'</div>'+
          '</div>'
        ).join('')+
        '</div>'
      :'<div style="font-size:11px;color:var(--text3)">暂无关联预警</div>')+
    '</div>'+

    '<div style="background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:14px">'+
      '<div style="font-size:13px;font-weight:700;color:var(--purple);margin-bottom:10px">📡 关联事件 ('+events.length+')</div>'+
      (events.length?
        '<div style="display:flex;flex-direction:column;gap:8px">'+
        events.map(e=>
          '<div style="background:var(--bg);border:1px solid var(--border);border-left:3px solid '+(e.sev==='critical'?'var(--red)':e.sev==='high'?'var(--orange)':'var(--yellow')+';border-radius:6px;padding:10px">'+
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">'+
              '<div style="font-size:12px;font-weight:600;color:var(--text)">'+e.title+'</div>'+
              '<span class="badge '+(e.sev==='critical'?'b-red':e.sev==='high'?'b-orange':'b-yellow')+'" style="font-size:9px">'+e.sev+'</span>'+
            '</div>'+
            '<div style="font-size:10px;color:var(--text3);margin-bottom:3px">'+e.date+' · '+e.country+'</div>'+
            '<div style="font-size:11px;color:var(--text2);line-height:1.5">'+e.desc.substring(0,120)+'...</div>'+
            '<div style="font-size:10px;color:var(--orange);margin-top:4px">影响: '+e.impact+'</div>'+
          '</div>'
        ).join('')+
        '</div>'
      :'<div style="font-size:11px;color:var(--text3)">暂无关联事件</div>')+
    '</div>';
  },

  /* ===== 评估结论表单 ===== */
  showAssessForm(id){
    const o=this.findOrg(id);if(!o)return;
    const a=THREAT_ASSESS.get(id)||{};
    const formHtml='<div style="background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:20px">'+
      '<div style="font-size:14px;font-weight:700;color:var(--cyan);margin-bottom:16px">📝 '+(a.assessor?'修改':'添加')+'评估结论 — '+(o.name||'')+'</div>'+

      '<div style="margin-bottom:14px">'+
        '<label style="display:block;font-size:11px;color:var(--text2);margin-bottom:6px">威胁指数 (1-10)</label>'+
        '<div style="display:flex;align-items:center;gap:10px">'+
          '<input type="range" id="assess-threat" min="1" max="10" step="0.5" value="'+(a.threatIndex||o.threatLevel||5)+'" style="flex:1" oninput="document.getElementById(\'assess-threat-val\').textContent=this.value"/>'+
          '<span id="assess-threat-val" style="font-size:20px;font-weight:700;color:'+this.threatColor(a.threatIndex||o.threatLevel||5)+';min-width:40px;text-align:center">'+(a.threatIndex||o.threatLevel||5)+'</span>'+
        '</div>'+
      '</div>'+

      '<div style="margin-bottom:14px">'+
        '<label style="display:block;font-size:11px;color:var(--text2);margin-bottom:6px">评估人</label>'+
        '<input class="input" id="assess-assessor" style="width:100%" value="'+(a.assessor||'')+'" placeholder="请输入评估人姓名"/>'+
      '</div>'+

      '<div style="margin-bottom:14px">'+
        '<label style="display:block;font-size:11px;color:var(--text2);margin-bottom:6px">评估结论</label>'+
        '<textarea class="input" id="assess-conclusion" style="width:100%;min-height:80px;resize:vertical" placeholder="对该威胁组织的总体评估结论...">'+(a.conclusion||'')+'</textarea>'+
      '</div>'+

      '<div style="margin-bottom:14px">'+
        '<label style="display:block;font-size:11px;color:var(--text2);margin-bottom:6px">风险研判</label>'+
        '<textarea class="input" id="assess-risk" style="width:100%;min-height:80px;resize:vertical" placeholder="对华威胁及风险分析...">'+(a.riskAnalysis||'')+'</textarea>'+
      '</div>'+

      '<div style="margin-bottom:16px">'+
        '<label style="display:block;font-size:11px;color:var(--text2);margin-bottom:6px">处置建议</label>'+
        '<textarea class="input" id="assess-recommend" style="width:100%;min-height:80px;resize:vertical" placeholder="针对性处置建议和对策...">'+(a.recommendation||'')+'</textarea>'+
      '</div>'+

      '<div style="display:flex;gap:8px;justify-content:flex-end">'+
        '<button class="btn" style="font-size:12px;padding:6px 16px;background:var(--panel);color:var(--text2)" onclick="document.getElementById(\'modal\').classList.remove(\'show\')">取消</button>'+
        '<button class="btn" style="font-size:12px;padding:6px 20px" onclick="THREATS.saveAssess(\''+id+'\')">💾 保存评估</button>'+
      '</div>'+
    '</div>';

    document.getElementById('modal-tt').innerHTML='📝 评估结论 — '+(o.name||'');
    document.getElementById('modal-bd').innerHTML=formHtml;
    document.getElementById('modal').classList.add('show');
    const box=document.querySelector('#modal .modal-box');
    if(box)box.style.maxWidth='640px';
  },

  saveAssess(id){
    const o=this.findOrg(id);if(!o)return;
    const assess={
      threatIndex:parseFloat(document.getElementById('assess-threat').value),
      assessor:document.getElementById('assess-assessor').value||'匿名评估',
      conclusion:document.getElementById('assess-conclusion').value,
      riskAnalysis:document.getElementById('assess-risk').value,
      recommendation:document.getElementById('assess-recommend').value,
      date:new Date().toISOString().slice(0,10),
      orgName:o.name
    };
    THREAT_ASSESS.set(id,assess);
    if(typeof showToast==='function')showToast('评估结论已保存');
    document.getElementById('modal').classList.remove('show');
    this.showDetail(id);
    this.switchTab('conclusion');
    this.render();
  },

  deleteAssess(id){
    if(!confirm('确定要删除该评估结论吗？'))return;
    THREAT_ASSESS.remove(id);
    if(typeof showToast==='function')showToast('评估结论已删除');
    this.showDetail(id);
    this.switchTab('conclusion');
    this.render();
  },

  /* ===== 自定义组织表单 ===== */
  showOrgForm(id){
    const o=id?this.findOrg(id):null;
    const isEdit=!!o;
    const d=o||{name:'',aliases:[],type:'恐怖组织',category:'宗教极端',subcategory:'',founded:'',foundedLocation:'',status:'活跃',threatLevel:7.0,threatTrend:'稳定',leader:'',members:'',operatingRegions:[],ideology:'',funding:'',description:'',structure:[],events:[],statements:[]};

    const formHtml='<div style="background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:20px;max-height:70vh;overflow-y:auto">'+
      '<div style="font-size:14px;font-weight:700;color:var(--cyan);margin-bottom:16px">'+(isEdit?'✏️ 编辑':'➕ 新增')+'威胁组织</div>'+

      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">'+
        '<div><label style="display:block;font-size:11px;color:var(--text2);margin-bottom:4px">组织名称 *</label><input class="input" id="org-name" style="width:100%" value="'+(d.name||'')+'" placeholder="如：俾路支解放军"/></div>'+
        '<div><label style="display:block;font-size:11px;color:var(--text2);margin-bottom:4px">别名（逗号分隔）</label><input class="input" id="org-aliases" style="width:100%" value="'+((d.aliases||[]).join(', '))+'" placeholder="BLA, BLF"/></div>'+
      '</div>'+

      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">'+
        '<div><label style="display:block;font-size:11px;color:var(--text2);margin-bottom:4px">组织类型</label>'+
          '<select class="input" id="org-type" style="width:100%">'+
            '<option value="恐怖组织" '+(d.type==='恐怖组织'?'selected':'')+'>恐怖组织</option>'+
            '<option value="犯罪组织" '+(d.type==='犯罪组织'?'selected':'')+'>犯罪组织</option>'+
          '</select></div>'+
        '<div><label style="display:block;font-size:11px;color:var(--text2);margin-bottom:4px">主要分类</label>'+
          '<select class="input" id="org-category" style="width:100%">'+
            '<option value="宗教极端" '+(d.category==='宗教极端'?'selected':'')+'>宗教极端</option>'+
            '<option value="民族分离" '+(d.category==='民族分离'?'selected':'')+'>民族分离</option>'+
            '<option value="贩毒集团" '+(d.category==='贩毒集团'?'selected':'')+'>贩毒集团</option>'+
            '<option value="黑社会组织" '+(d.category==='黑社会组织'?'selected':'')+'>黑社会组织</option>'+
            '<option value="其他" '+(d.category==='其他'?'selected':'')+'>其他</option>'+
          '</select></div>'+
      '</div>'+

      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">'+
        '<div><label style="display:block;font-size:11px;color:var(--text2);margin-bottom:4px">成立时间</label><input class="input" id="org-founded" style="width:100%" value="'+(d.founded||'')+'" placeholder="如：2000"/></div>'+
        '<div><label style="display:block;font-size:11px;color:var(--text2);margin-bottom:4px">成立地点</label><input class="input" id="org-foundedLoc" style="width:100%" value="'+(d.foundedLocation||'')+'" placeholder="如：巴基斯坦俾路支省"/></div>'+
      '</div>'+

      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">'+
        '<div><label style="display:block;font-size:11px;color:var(--text2);margin-bottom:4px">当前状态</label>'+
          '<select class="input" id="org-status" style="width:100%">'+
            '<option value="活跃" '+(d.status==='活跃'?'selected':'')+'>活跃</option>'+
            '<option value="潜伏活跃" '+(d.status==='潜伏活跃'?'selected':'')+'>潜伏活跃</option>'+
            '<option value="执政（争议性）" '+(d.status==='执政（争议性）'?'selected':'')+'>执政（争议性）</option>'+
            '<option value="分裂活跃" '+(d.status==='分裂活跃'?'selected':'')+'>分裂活跃</option>'+
            '<option value="衰落" '+(d.status==='衰落'?'selected':'')+'>衰落</option>'+
          '</select></div>'+
        '<div><label style="display:block;font-size:11px;color:var(--text2);margin-bottom:4px">威胁趋势</label>'+
          '<select class="input" id="org-trend" style="width:100%">'+
            '<option value="上升" '+(d.threatTrend==='上升'?'selected':'')+'>上升</option>'+
            '<option value="稳定" '+(d.threatTrend==='稳定'?'selected':'')+'>稳定</option>'+
            '<option value="下降" '+(d.threatTrend==='下降'?'selected':'')+'>下降</option>'+
          '</select></div>'+
      '</div>'+

      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">'+
        '<div><label style="display:block;font-size:11px;color:var(--text2);margin-bottom:4px">现任领导人</label><input class="input" id="org-leader" style="width:100%" value="'+(d.leader||'')+'" placeholder="如：巴赫什·马里"/></div>'+
        '<div><label style="display:block;font-size:11px;color:var(--text2);margin-bottom:4px">成员规模</label><input class="input" id="org-members" style="width:100%" value="'+(d.members||'')+'" placeholder="如：约1,000-3,000"/></div>'+
      '</div>'+

      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">'+
        '<div><label style="display:block;font-size:11px;color:var(--text2);margin-bottom:4px">威胁指数 (1-10)</label><input type="number" class="input" id="org-threat" style="width:100%" min="1" max="10" step="0.5" value="'+(d.threatLevel||7)+'"/></div>'+
        '<div><label style="display:block;font-size:11px;color:var(--text2);margin-bottom:4px">活动区域（逗号分隔）</label><input class="input" id="org-regions" style="width:100%" value="'+((d.operatingRegions||[]).join(', '))+'" placeholder="巴基斯坦, 阿富汗, 伊朗"/></div>'+
      '</div>'+

      '<div style="margin-bottom:12px"><label style="display:block;font-size:11px;color:var(--text2);margin-bottom:4px">意识形态</label><input class="input" id="org-ideology" style="width:100%" value="'+(d.ideology||'')+'" placeholder="如：民族分离主义"/></div>'+
      '<div style="margin-bottom:12px"><label style="display:block;font-size:11px;color:var(--text2);margin-bottom:4px">资金来源</label><input class="input" id="org-funding" style="width:100%" value="'+(d.funding||'')+'" placeholder="如：外国资助、绑架赎金、走私"/></div>'+
      '<div style="margin-bottom:16px"><label style="display:block;font-size:11px;color:var(--text2);margin-bottom:4px">组织描述</label><textarea class="input" id="org-desc" style="width:100%;min-height:100px;resize:vertical" placeholder="详细描述该组织的背景、目标和主要活动...">'+(d.description||'')+'</textarea></div>'+

      '<div style="display:flex;gap:8px;justify-content:flex-end">'+
        '<button class="btn" style="font-size:12px;padding:6px 16px;background:var(--panel);color:var(--text2)" onclick="document.getElementById(\'modal\').classList.remove(\'show\')">取消</button>'+
        '<button class="btn" style="font-size:12px;padding:6px 20px" onclick="THREATS.saveOrg('+(isEdit?'\''+id+'\'':'null')+')">💾 保存</button>'+
      '</div>'+
    '</div>';

    document.getElementById('modal-tt').innerHTML=(isEdit?'✏️ 编辑':'➕ 新增')+'威胁组织';
    document.getElementById('modal-bd').innerHTML=formHtml;
    document.getElementById('modal').classList.add('show');
    const box=document.querySelector('#modal .modal-box');
    if(box)box.style.maxWidth='640px';
  },

  saveOrg(id){
    const name=document.getElementById('org-name').value.trim();
    if(!name){if(typeof showToast==='function')showToast('请输入组织名称');return;}
    const org={
      name:name,
      aliases:document.getElementById('org-aliases').value.split(',').map(s=>s.trim()).filter(s=>s),
      type:document.getElementById('org-type').value,
      category:document.getElementById('org-category').value,
      founded:document.getElementById('org-founded').value.trim(),
      foundedLocation:document.getElementById('org-foundedLoc').value.trim(),
      status:document.getElementById('org-status').value,
      threatTrend:document.getElementById('org-trend').value,
      leader:document.getElementById('org-leader').value.trim(),
      members:document.getElementById('org-members').value.trim(),
      threatLevel:parseFloat(document.getElementById('org-threat').value)||7,
      operatingRegions:document.getElementById('org-regions').value.split(',').map(s=>s.trim()).filter(s=>s),
      ideology:document.getElementById('org-ideology').value.trim(),
      funding:document.getElementById('org-funding').value.trim(),
      description:document.getElementById('org-desc').value.trim(),
      structure:[],
      events:[],
      statements:[],
      designation:[],
      formerLeaders:[],
      subcategory:'—',
      fundingEstimate:'—',
      weaponLevel:'—',
      cyberCapability:'—'
    };
    if(id){
      THREAT_CUSTOM.update(id,org);
      if(typeof showToast==='function')showToast('组织信息已更新');
    }else{
      id=THREAT_CUSTOM.add(org);
      if(typeof showToast==='function')showToast('自定义组织已添加');
    }
    document.getElementById('modal').classList.remove('show');
    this.render();
  },

  deleteOrg(id){
    if(!confirm('确定要删除该自定义组织吗？此操作不可撤销。'))return;
    THREAT_CUSTOM.remove(id);
    THREAT_ASSESS.remove(id);
    if(typeof showToast==='function')showToast('自定义组织已删除');
    this.render();
  }
};

/* ===== 集成说明 ===== */
/* 威胁组织 v2.0 — 交互式情报档案
   功能: 筛选/排序/卡片表格双视图/评估结论CRUD/自定义组织CRUD/系统数据关联
   app.js 的 navigateTo('threatorgs') 会调用 THREATS.render()
   数据关联: ENTERPRISES(中资企业) / ALERTS(预警) / EVENTS(事件) by operatingRegions */
