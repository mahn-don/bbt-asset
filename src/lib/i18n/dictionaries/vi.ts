import type { Messages } from "./en";

/**
 * Vietnamese dictionary.
 *
 * Typed as `Messages`, so a key added to `en` and forgotten here is a compile
 * error rather than a blank label at runtime.
 *
 * Technical identifiers are intentionally left in English: provider names
 * (HackerOne, Bugcrowd, Intigriti, YesWeHack), asset types (API, URL, CIDR,
 * WILDCARD, Android, iOS), protocol names, model ids, domain names and
 * external ids. Translating those would reduce clarity for a researcher who
 * reads them in provider dashboards in English.
 */

export const vi: Messages = {
  // --- Brand / chrome -----------------------------------------------------
  "app.name": "Asset Intelligence",
  "app.brandShort": "BBI",
  "app.tagline": "Kho phạm vi bug bounty và ưu tiên nghiên cứu.",
  "app.footerNote":
    "Điểm số xếp hạng cơ hội nghiên cứu, không phải mức độ nghiêm trọng của lỗ hổng. Chỉ những tài sản được dữ liệu nền tảng xác nhận nằm trong phạm vi mới được phép nghiên cứu.",

  // --- Navigation ---------------------------------------------------------
  "nav.primary": "Điều hướng chính",
  "nav.dashboard": "Tổng quan",
  "nav.assets": "Tài sản",
  "nav.programs": "Chương trình",
  "nav.changes": "Thay đổi",
  "nav.settings": "Cài đặt",
  "nav.signOut": "Đăng xuất",
  "nav.signingOut": "Đang đăng xuất…",
  "nav.theme": "Giao diện",
  "nav.language": "Ngôn ngữ",
  "nav.openSettings": "Mở cài đặt",

  // --- Auth ---------------------------------------------------------------
  "auth.email": "Email",
  "auth.password": "Mật khẩu",
  "auth.signIn": "Đăng nhập",
  "auth.signingIn": "Đang đăng nhập…",
  "auth.failed": "Đăng nhập thất bại.",
  "auth.networkError": "Lỗi mạng — không thể kết nối tới máy chủ.",
  "auth.noAccountTitle": "Chưa có tài khoản nào. Tạo tài khoản bằng lệnh:",

  // --- Common -------------------------------------------------------------
  "common.save": "Lưu",
  "common.saving": "Đang lưu…",
  "common.cancel": "Hủy",
  "common.reset": "Đặt lại",
  "common.apply": "Áp dụng bộ lọc",
  "common.search": "Tìm kiếm",
  "common.all": "Tất cả",
  "common.any": "Bất kỳ",
  "common.yes": "Có",
  "common.no": "Không",
  "common.none": "Không có",
  "common.never": "Chưa bao giờ",
  "common.unknown": "Không rõ",
  "common.notPublished": "Không công bố",
  "common.notSpecified": "Không xác định",
  "common.enabled": "Đang bật",
  "common.disabled": "Đã tắt",
  "common.loading": "Đang tải…",
  "common.perPage": "Mỗi trang",
  "common.sort": "Sắp xếp",
  "common.previous": "Trước",
  "common.next": "Sau",
  "common.pagination": "Phân trang",
  "common.pageOf": "Trang {page} / {total}",
  "common.networkError": "Lỗi mạng — không thể kết nối tới máy chủ.",
  "common.justNow": "vừa xong",
  "common.minutesAgo": "{count} phút trước",
  "common.hoursAgo": "{count} giờ trước",
  "common.daysAgo": "{count} ngày trước",
  "common.monthsAgo": "{count} tháng trước",
  "common.version": "Phiên bản",

  // --- Dashboard ----------------------------------------------------------
  "dashboard.title": "Tổng quan",
  "dashboard.description": "Phạm vi được cho phép, xếp hạng theo cơ hội nghiên cứu.",
  "dashboard.opportunities": "Cơ hội hôm nay",
  "dashboard.opportunitiesSubtitle":
    "Điểm cơ hội nghiên cứu cao nhất trong phạm vi đang hoạt động.",
  "dashboard.allAssets": "Tất cả tài sản",
  "dashboard.allChanges": "Tất cả thay đổi",
  "dashboard.recentChanges": "Thay đổi gần đây",
  "dashboard.noOpportunities": "Chưa có cơ hội nào được chấm điểm",
  "dashboard.noOpportunitiesHelp":
    "Hãy cấu hình tích hợp nền tảng, chạy đồng bộ, rồi để hàng đợi AI xử lý. Phạm vi chưa được đánh giá không bao giờ hiển thị là điểm 0.",
  "dashboard.noChanges": "Chưa ghi nhận thay đổi nào",
  "dashboard.noChangesHelp":
    "Sự kiện thay đổi xuất hiện từ lần đồng bộ thứ hai, khi đã có ảnh chụp trước đó để so sánh.",
  "dashboard.processJobs": "Xử lý {count} tác vụ AI",
  "dashboard.processJobs_plural": "Xử lý {count} tác vụ AI",
  "dashboard.processing": "Đang xử lý…",
  "dashboard.processed": "Đã xử lý {processed}; còn {pending} trong hàng đợi.",
  "dashboard.queueFailed": "Không thể xử lý hàng đợi.",

  // --- Metrics ------------------------------------------------------------
  "metric.programs": "Chương trình",
  "metric.activeScopes": "Phạm vi đang hoạt động",
  "metric.newAssets": "Tài sản mới",
  "metric.newAssetsHint": "7 ngày qua",
  "metric.changesToday": "Thay đổi hôm nay",
  "metric.highOpportunity": "Cơ hội tiềm năng cao",
  "metric.highOpportunityHint": "điểm từ 80",
  "metric.pendingAi": "AI đang chờ xử lý",
  "metric.pendingAiHint": "đánh giá trong hàng đợi",
  "metric.failedJobs": "{count} tác vụ thất bại",
  "metric.findings": "Phát hiện",
  "metric.totalPayout": "Tổng tiền thưởng",

  // --- Assets -------------------------------------------------------------
  "assets.title": "Tài sản",
  "assets.description":
    "Phạm vi được cho phép trên mọi nền tảng đã kết nối. Sắp xếp theo cơ hội nghiên cứu.",
  "assets.count": "{count} tài sản",
  "assets.count_plural": "{count} tài sản",
  "assets.unevaluatedNote":
    "{count} chưa được đánh giá — hiển thị là “—”, không bao giờ là điểm 0.",
  "assets.empty": "Không có tài sản nào khớp bộ lọc",
  "assets.emptyHelp":
    "Kết nối một nền tảng trong mục Tích hợp và chạy đồng bộ để nạp dữ liệu.",
  "assets.invalidFilters": "Một số bộ lọc không hợp lệ và đã được đặt lại.",

  "assets.col.score": "Điểm AI",
  "assets.col.asset": "Tài sản",
  "assets.col.program": "Chương trình",
  "assets.col.provider": "Nền tảng",
  "assets.col.type": "Loại",
  "assets.col.status": "Trạng thái",
  "assets.col.bounty": "Thưởng",
  "assets.col.maxSeverity": "Mức tối đa",
  "assets.col.tags": "Thẻ",
  "assets.col.lastChanged": "Thay đổi lần cuối",
  "assets.col.coverage": "Đã nghiên cứu",
  "assets.sessions": "{count} phiên",
  "assets.sessions_plural": "{count} phiên",

  "filter.search": "Tìm kiếm",
  "filter.searchPlaceholder": "định danh tài sản",
  "filter.provider": "Nền tảng",
  "filter.program": "Chương trình",
  "filter.type": "Loại",
  "filter.scopeStatus": "Trạng thái phạm vi",
  "filter.scopeStatusDefault": "Trong phạm vi (mặc định)",
  "filter.maxSeverity": "Mức độ nghiêm trọng tối đa",
  "filter.bountyEligible": "Đủ điều kiện nhận thưởng",
  "filter.tag": "Thẻ",
  "filter.minScore": "Điểm tối thiểu",
  "filter.maxScore": "Điểm tối đa",
  "filter.isNew": "Mới (7 ngày)",
  "filter.recentlyChanged": "Vừa thay đổi",
  "filter.notEvaluated": "Chưa đánh giá",
  "filter.notReviewed": "Chưa xem xét",

  "sort.opportunity": "Điểm cơ hội",
  "sort.newest": "Mới nhất",
  "sort.recentlyChanged": "Vừa thay đổi",
  "sort.severity": "Mức nghiêm trọng cao nhất",
  "sort.leastReviewed": "Ít được xem xét nhất",

  // --- Asset detail -------------------------------------------------------
  "asset.scopeClassification": "Phân loại phạm vi",
  "asset.researchAuthorization": "Ủy quyền nghiên cứu",
  "asset.assetType": "Loại tài sản",
  "asset.bountyEligible": "Đủ điều kiện nhận thưởng",
  "asset.submissionEligible": "Đủ điều kiện gửi báo cáo",
  "asset.maxSeverity": "Mức độ nghiêm trọng tối đa",
  "asset.opportunity": "Cơ hội",
  "asset.providerData": "Dữ liệu từ nền tảng",
  "asset.scopeInstructions": "Hướng dẫn phạm vi",
  "asset.noInstructions": "Nền tảng không công bố hướng dẫn cho phạm vi này",
  "asset.sourceUpdated": "Nguồn cập nhật",
  "asset.firstSeen": "Lần đầu ghi nhận",
  "asset.lastSeen": "Lần cuối ghi nhận",
  "asset.lastSync": "Đồng bộ lần cuối",
  "asset.provenance": "Nguồn gốc",
  "asset.provenanceProvider": "Nền tảng xác minh",
  "asset.provenanceManual": "Nhập thủ công",
  "asset.programStatus": "Trạng thái chương trình",
  "asset.visibility": "Phạm vi hiển thị",
  "asset.safeHarbor": "Safe harbour",
  "asset.bountyRange": "Khoảng tiền thưởng",
  "asset.openOnProvider": "Mở chương trình trên {provider}",
  "asset.authorizedNote":
    "Dữ liệu nền tảng xác nhận tài sản này nằm trong phạm vi và đủ điều kiện gửi báo cáo. Ủy quyền chỉ được thiết lập từ dữ liệu nền tảng — không bao giờ từ kết quả AI.",
  "asset.verifiedAt": "Cổng kiểm tra ủy quyền · xác minh",

  // --- Authorization ------------------------------------------------------
  "authz.verified": "ĐÃ XÁC MINH",
  "authz.userConfirmed": "NGƯỜI DÙNG XÁC NHẬN",
  "authz.notVerified": "CHƯA XÁC MINH",
  "authz.reason.SCOPE_NOT_FOUND": "Tài sản này không tồn tại trong kho dữ liệu.",
  "authz.reason.SCOPE_REMOVED":
    "Tài sản đã bị loại khỏi phạm vi chương trình và không còn được ủy quyền.",
  "authz.reason.SCOPE_OUT_OF_SCOPE": "Nền tảng liệt kê tài sản này là ngoài phạm vi.",
  "authz.reason.SCOPE_STATUS_UNKNOWN": "Trạng thái ủy quyền của tài sản này không rõ ràng.",
  "authz.reason.SUBMISSION_NOT_ELIGIBLE":
    "Nền tảng đánh dấu tài sản này không đủ điều kiện gửi báo cáo.",
  "authz.reason.PROGRAM_NOT_ACTIVE": "Chương trình hiện không hoạt động.",
  "authz.reason.PROVIDER_DISABLED":
    "Tích hợp nền tảng đang tắt nên không thể xác minh phạm vi.",
  "authz.reason.DATA_STALE":
    "Dữ liệu nền tảng đã cũ hơn giới hạn cho phép và cần được đồng bộ lại.",
  "authz.reason.NO_PROVIDER_SNAPSHOT": "Không có ảnh chụp nào từ nền tảng cho tài sản này.",
  "authz.reason.MANUAL_NOT_CONFIRMED":
    "Tài sản thủ công này chưa được xác nhận rõ ràng là đã được ủy quyền.",

  // --- AI evaluation panel ------------------------------------------------
  "ai.evaluation": "Đánh giá AI",
  "ai.evaluationSource": "Nguồn đánh giá",
  "ai.sourceModel": "MÔ HÌNH AI",
  "ai.sourceHeuristic": "QUY TẮC",
  "ai.offlineRuleEngine": "Bộ quy tắc ngoại tuyến",
  "ai.provider": "Nhà cung cấp",
  "ai.model": "Mô hình",
  "ai.notEvaluated": "Chưa được đánh giá",
  "ai.queued": "Đã đưa vào hàng đợi đánh giá",
  "ai.lastFailed": "Lần đánh giá gần nhất thất bại",
  "ai.evaluateHelp":
    "Nhấn “Đánh giá lại bằng AI” để đưa vào hàng đợi, hoặc chạy worker để xử lý hàng đợi.",
  "ai.reevaluate": "Đánh giá lại bằng AI",
  "ai.evaluating": "Đang đánh giá…",
  "ai.evaluatedScore": "Đã đánh giá — điểm {score}.",
  "ai.evaluationFailed": "Đánh giá thất bại; xem chi tiết ở bảng AI.",
  "ai.evaluationQueued": "Đã vào hàng đợi. Chạy worker để xử lý.",
  "ai.confidence": "Độ tin cậy",
  "ai.evaluatedAt": "Đánh giá lúc",
  "ai.whyInteresting": "Vì sao đáng chú ý",
  "ai.dimensionScores": "Điểm theo từng tiêu chí",
  "ai.scoreNote":
    "Điểm cuối cùng do ứng dụng tính từ các tiêu chí có trọng số, không bao giờ lấy trực tiếp từ mô hình.",
  "ai.tags": "Thẻ",
  "ai.suggestedResearch": "Khu vực nghiên cứu đề xuất",
  "ai.warnings": "Cảnh báo",
  "ai.evaluationHistory": "Lịch sử đánh giá AI",
  "ai.noEvaluations": "Chưa ghi nhận đánh giá nào",
  "ai.writtenInOtherLanguage":
    "Đánh giá này được viết bằng {language}. Hãy đánh giá lại để tạo nội dung theo ngôn ngữ hiện tại.",

  // --- Score dimensions ---------------------------------------------------
  "score.businessValue": "Giá trị kinh doanh",
  "score.attackSurface": "Bề mặt tấn công",
  "score.freshness": "Độ mới",
  "score.researchPotential": "Tiềm năng nghiên cứu",
  "score.complexity": "Độ phức tạp",
  "score.policyFit": "Mức phù hợp với chính sách",
  "score.duplicateRisk": "Rủi ro trùng lặp",
  "score.duplicateRiskHelp":
    "0 = rủi ro thấp, 100 = rủi ro cao. Công thức Điểm cơ hội tự đảo ngược giá trị này bên trong.",
  "score.opportunityScore": "Điểm cơ hội",
  "score.researchOpportunity": "Cơ hội nghiên cứu",
  "score.notEvaluated": "Chưa đánh giá",
  "score.aiPending": "AI đang chờ",
  "score.aiFailed": "AI thất bại",
  "score.stale": "Đã lỗi thời",
  "score.weight": "Trọng số",

  // --- Opportunity bands --------------------------------------------------
  "band.HIGH": "Cao",
  "band.MEDIUM_HIGH": "Khá cao",
  "band.MEDIUM": "Trung bình",
  "band.LOW": "Thấp",

  // --- History ------------------------------------------------------------
  "history.scope": "Lịch sử phạm vi",
  "history.change": "Lịch sử thay đổi",
  "history.noChanges": "Chưa ghi nhận thay đổi nào cho tài sản này",
  "history.noVersions": "Chưa ghi nhận phiên bản nào",
  "history.before": "Trước",
  "history.after": "Sau",
  "history.validFrom": "Hiệu lực từ",
  "history.validTo": "Hiệu lực đến",
  "history.current": "Hiện tại",
  "history.contentHash": "Mã băm nội dung",
  "history.versions": "{count} phiên bản",
  "history.changesRecorded": "{count} thay đổi được ghi nhận",

  // --- Programs -----------------------------------------------------------
  "programs.title": "Chương trình",
  "programs.description":
    "Mọi chương trình nhập từ nền tảng đã kết nối, cùng các chương trình nhập thủ công.",
  "programs.count": "{count} chương trình",
  "programs.count_plural": "{count} chương trình",
  "programs.empty": "Chưa nhập chương trình nào",
  "programs.emptyHelp": "Cấu hình một nền tảng trong mục Tích hợp và chạy đồng bộ.",
  "programs.col.handle": "Định danh",
  "programs.col.scopes": "Phạm vi",
  "programs.col.active": "Đang hoạt động",
  "programs.col.bountyMax": "Thưởng tối đa",
  "programs.col.lastSynced": "Đồng bộ lần cuối",

  // --- Changes ------------------------------------------------------------
  "changes.title": "Thay đổi",
  "changes.description":
    "Mọi khác biệt có ý nghĩa được phát hiện giữa các ảnh chụp từ nền tảng.",
  "changes.count": "{count} sự kiện thay đổi",
  "changes.count_plural": "{count} sự kiện thay đổi",
  "changes.empty": "Không có sự kiện thay đổi",
  "changes.emptyHelp":
    "Thay đổi được ghi nhận từ lần đồng bộ thứ hai, khi đã có ảnh chụp trước đó để so sánh.",
  "changes.type": "Loại thay đổi",
  "changes.importance": "Mức quan trọng",
  "changes.filter": "Lọc",
  "changes.programLevel": "Thay đổi ở cấp chương trình",

  "changeType.ASSET_ADDED": "Thêm tài sản",
  "changeType.ASSET_REMOVED": "Loại bỏ tài sản",
  "changeType.ASSET_CHANGED": "Tài sản thay đổi",
  "changeType.BOUNTY_ELIGIBILITY_CHANGED": "Thay đổi điều kiện nhận thưởng",
  "changeType.SUBMISSION_ELIGIBILITY_CHANGED": "Thay đổi điều kiện gửi báo cáo",
  "changeType.MAX_SEVERITY_CHANGED": "Thay đổi mức nghiêm trọng tối đa",
  "changeType.INSTRUCTION_CHANGED": "Thay đổi hướng dẫn",
  "changeType.POLICY_CHANGED": "Thay đổi chính sách",
  "changeType.PROGRAM_CHANGED": "Thay đổi chương trình",

  "importance.LOW": "Thấp",
  "importance.MEDIUM": "Trung bình",
  "importance.HIGH": "Cao",
  "importance.CRITICAL_ATTENTION": "Cần chú ý đặc biệt",
  "importance.criticalHelp":
    "Mức ưu tiên xem xét nghiên cứu cao. Đây không phải mức độ nghiêm trọng của lỗ hổng.",

  // --- Statuses -----------------------------------------------------------
  "scopeStatus.IN_SCOPE": "Trong phạm vi",
  "scopeStatus.OUT_OF_SCOPE": "Ngoài phạm vi",
  "scopeStatus.REMOVED": "Đã bị loại bỏ",
  "scopeStatus.UNKNOWN": "Không rõ",

  "severity.CRITICAL": "Nghiêm trọng",
  "severity.HIGH": "Cao",
  "severity.MEDIUM": "Trung bình",
  "severity.LOW": "Thấp",
  "severity.NONE": "Không có",

  "programStatus.ACTIVE": "Đang hoạt động",
  "programStatus.PAUSED": "Tạm dừng",
  "programStatus.ARCHIVED": "Đã lưu trữ",
  "programStatus.UNKNOWN": "Không rõ",

  "visibility.PUBLIC": "Công khai",
  "visibility.PRIVATE": "Riêng tư",
  "visibility.UNKNOWN": "Không rõ",

  "badge.new": "Mới",
  "badge.changed": "Đã thay đổi",
  "badge.removed": "Đã bị loại bỏ",

  "connection.CONNECTED": "Đã kết nối",
  "connection.NOT_CONFIGURED": "Chưa cấu hình",
  "connection.AUTH_ERROR": "Lỗi xác thực",
  "connection.PERMISSION_ERROR": "Lỗi quyền truy cập",
  "connection.RATE_LIMITED": "Bị giới hạn tần suất",
  "connection.API_ERROR": "Lỗi API",
  "connection.UNSUPPORTED": "Không hỗ trợ",
  "connection.DISABLED": "Đã tắt",
  "connection.READY": "Sẵn sàng",

  "syncStatus.RUNNING": "Đang chạy",
  "syncStatus.SUCCESS": "Thành công",
  "syncStatus.PARTIAL": "Một phần",
  "syncStatus.FAILED": "Thất bại",

  "evalStatus.PENDING": "Đang chờ",
  "evalStatus.PROCESSING": "Đang xử lý",
  "evalStatus.COMPLETED": "Hoàn tất",
  "evalStatus.FAILED": "Thất bại",
  "evalStatus.STALE": "Đã lỗi thời",

  // --- Settings shell -----------------------------------------------------
  "settings.title": "Cài đặt",
  "settings.groupGeneral": "Chung",
  "settings.groupIntelligence": "Trí tuệ nhân tạo",
  "settings.groupIntegrations": "Tích hợp",
  "settings.appearance": "Giao diện",
  "settings.language": "Ngôn ngữ",
  "settings.ai": "AI",
  "settings.integrations": "Tích hợp API",
  "settings.nav": "Các mục cài đặt",

  // --- Appearance ---------------------------------------------------------
  "appearance.title": "Giao diện",
  "appearance.description": "Chọn cách hiển thị giao diện cho tài khoản này.",
  "appearance.theme": "Chủ đề",
  "appearance.light": "Sáng",
  "appearance.dark": "Tối",
  "appearance.system": "Theo hệ thống",
  "appearance.lightHelp": "Nền sáng, chữ tối.",
  "appearance.darkHelp": "Nền gần như đen, chữ sáng.",
  "appearance.systemHelp": "Theo thiết lập của hệ điều hành.",
  "appearance.saved": "Đã cập nhật giao diện.",

  // --- Language -----------------------------------------------------------
  "language.title": "Ngôn ngữ",
  "language.description": "Chọn ngôn ngữ sử dụng trong toàn bộ giao diện.",
  "language.select": "Ngôn ngữ giao diện",
  "language.saved": "Đã cập nhật ngôn ngữ.",
  "language.aiNote":
    "Các đánh giá AI mới sẽ được tạo bằng ngôn ngữ đã chọn. Những đánh giá cũ vẫn giữ nguyên ngôn ngữ ban đầu — hãy đánh giá lại tài sản để tạo lại nội dung. Các định danh kỹ thuật như tên miền, loại tài sản và tên nền tảng không bao giờ được dịch.",

  // --- AI settings --------------------------------------------------------
  "aiSettings.title": "Cài đặt AI",
  "aiSettings.description":
    "Cấu hình mô hình dùng để chấm điểm và giải thích phạm vi. Khóa được mã hóa khi lưu và không bao giờ được trả về.",
  "aiSettings.provider": "Nhà cung cấp AI",
  "aiSettings.apiKey": "Khóa API",
  "aiSettings.apiKeyConfigured": "Đã cấu hình",
  "aiSettings.apiKeyNotConfigured": "Chưa cấu hình",
  "aiSettings.apiKeyPlaceholder": "Dán khóa mới để thay thế khóa đã lưu",
  "aiSettings.apiKeyHelp":
    "Được mã hóa bằng AES-256-GCM. Khóa không bao giờ hiển thị lại và không bao giờ gửi tới trình duyệt.",
  "aiSettings.model": "Mô hình",
  "aiSettings.customModel": "Mã mô hình tùy chỉnh",
  "aiSettings.customModelPlaceholder": "Nhập chính xác mã mô hình",
  "aiSettings.baseUrl": "Base URL",
  "aiSettings.baseUrlHelp": "Địa chỉ HTTPS của một API tương thích OpenAI.",
  "aiSettings.status": "Trạng thái",
  "aiSettings.testConnection": "Kiểm tra kết nối",
  "aiSettings.testing": "Đang kiểm tra…",
  "aiSettings.saveSettings": "Lưu cài đặt",
  "aiSettings.deleteKey": "Xóa khóa API",
  "aiSettings.deleteKeyConfirm":
    "Xóa khóa API đã lưu? Việc đánh giá sẽ quay về dùng bộ quy tắc.",
  "aiSettings.saved": "Đã lưu cài đặt AI.",
  "aiSettings.keyDeleted": "Đã xóa khóa API.",
  "aiSettings.features": "Tính năng AI",
  "aiSettings.enabled": "Bật AI",
  "aiSettings.scopeEvaluation": "Đánh giá phạm vi",
  "aiSettings.changeAnalysis": "Phân tích thay đổi",
  "aiSettings.autoEvaluateNew": "Tự động đánh giá phạm vi mới",
  "aiSettings.autoReevaluateChanged": "Tự động đánh giá lại phạm vi đã thay đổi",
  "aiSettings.heuristicFallback": "Dùng đánh giá quy tắc thay thế",
  "aiSettings.heuristicFallbackHelp":
    "Khi mô hình không khả dụng, chấm điểm bằng bộ quy tắc ngoại tuyến thay vì bỏ trống. Kết quả được gắn nhãn QUY TẮC, không phải AI.",
  "aiSettings.advanced": "Nâng cao",
  "aiSettings.temperature": "Temperature",
  "aiSettings.maxTokens": "Số token tối đa",
  "aiSettings.notConfiguredTitle": "Nhà cung cấp AI — Chưa cấu hình",
  "aiSettings.notConfiguredBody":
    "Đánh giá bằng mô hình AI đang tắt. Ứng dụng hiện chấm điểm bằng bộ quy tắc.",
  "aiSettings.envKeyNote":
    "Một khóa API cũng tồn tại trong biến môi trường (ANTHROPIC_API_KEY). Cài đặt lưu tại đây sẽ được ưu tiên.",

  "aiTest.connected": "Đã kết nối",
  "aiTest.invalidKey": "Khóa API không hợp lệ",
  "aiTest.permissionDenied": "Không có quyền truy cập",
  "aiTest.rateLimited": "Bị giới hạn tần suất",
  "aiTest.unavailable": "Nhà cung cấp không khả dụng",
  "aiTest.incomplete": "Cấu hình chưa đầy đủ",

  // --- AI summary card ----------------------------------------------------
  "aiSummary.title": "Trí tuệ AI",
  "aiSummary.manage": "Quản lý cài đặt AI",
  "aiSummary.configure": "Cấu hình AI",
  "aiSummary.heuristicProvider": "Bộ quy tắc thay thế",
  "aiSummary.noKeyStatus": "Chưa cấu hình khóa API cho AI",

  // --- Integrations -------------------------------------------------------
  "integrations.title": "Tích hợp API",
  "integrations.description":
    "Kết nối các nền tảng bug bounty. Thông tin đăng nhập được mã hóa bằng AES-256-GCM khi lưu và không bao giờ được API trả về.",
  "integrations.programs": "Chương trình",
  "integrations.activeScopes": "Phạm vi đang hoạt động",
  "integrations.credential": "Thông tin đăng nhập",
  "integrations.notRequired": "Không cần thiết",
  "integrations.lastTest": "Kiểm tra lần cuối",
  "integrations.lastSuccessfulSync": "Đồng bộ thành công lần cuối",
  "integrations.lastAttemptedSync": "Lần đồng bộ gần nhất",
  "integrations.lastRun": "Lần chạy gần nhất",
  "integrations.configure": "Cấu hình",
  "integrations.editCredentials": "Sửa thông tin đăng nhập",
  "integrations.testConnection": "Kiểm tra kết nối",
  "integrations.syncNow": "Đồng bộ ngay",
  "integrations.syncing": "Đang đồng bộ…",
  "integrations.enable": "Bật",
  "integrations.disable": "Tắt",
  "integrations.disconnect": "Ngắt kết nối",
  "integrations.syncHistory": "Lịch sử đồng bộ",
  "integrations.noCredentials": "Không cần thông tin đăng nhập",
  "integrations.enableFirst": "Hãy bật tích hợp trước.",
  "integrations.credentialsSaved": "Đã lưu và mã hóa thông tin đăng nhập.",
  "integrations.credentialsDeleted": "Đã xóa thông tin đăng nhập.",
  "integrations.integrationEnabled": "Đã bật tích hợp.",
  "integrations.integrationDisabled": "Đã tắt tích hợp.",
  "integrations.connected": "Đã kết nối.",
  "integrations.testFailed": "Kiểm tra kết nối thất bại.",
  "integrations.saveCredentials": "Lưu thông tin đăng nhập",
  "integrations.documentation": "Tài liệu",
  "integrations.syncSummary":
    "{status}: {programs} chương trình, {scopes} phạm vi, {changes} thay đổi, {jobs} tác vụ AI trong hàng đợi.",
  "integrations.requestFailed": "Yêu cầu thất bại ({status}).",

  // --- Sync history -------------------------------------------------------
  "syncHistory.title": "Lịch sử đồng bộ {provider}",
  "syncHistory.description":
    "Mọi lần đồng bộ, kèm các số liệu và lỗi được ghi nhận tại thời điểm đó.",
  "syncHistory.back": "Quay lại Tích hợp",
  "syncHistory.runs": "{count} lần chạy",
  "syncHistory.runs_plural": "{count} lần chạy",
  "syncHistory.empty": "Chưa ghi nhận lần đồng bộ nào cho nền tảng này",
  "syncHistory.col.status": "Trạng thái",
  "syncHistory.col.trigger": "Kích hoạt",
  "syncHistory.col.started": "Bắt đầu",
  "syncHistory.col.duration": "Thời lượng",
  "syncHistory.col.created": "Đã tạo",
  "syncHistory.col.updated": "Đã cập nhật",
  "syncHistory.col.removed": "Đã loại bỏ",
  "syncHistory.col.changes": "Thay đổi",
  "syncHistory.col.aiJobs": "Tác vụ AI",
  "syncHistory.col.rateLimits": "429s",
  "syncHistory.col.retries": "Thử lại",
  "syncHistory.col.error": "Lỗi",

  // --- AI Supporter -------------------------------------------------------
  "nav.aiSupporter": "Trợ lý AI",
  "aiSupporter.title": "Trợ lý AI",
  "aiSupporter.description":
    "Các đề xuất do AI hỗ trợ. Bộ lọc xác định thu hẹp toàn bộ kho về phạm vi đủ điều kiện một cách miễn phí; sau đó mô hình xếp hạng và giải thích một phần nhỏ có giá trị cao, trong giới hạn.",
  "aiSupporter.funnel": "Phễu ưu tiên",
  "aiSupporter.funnelNote":
    "Mỗi bước chỉ là một phép đếm — không dùng AI, tức thời. Chỉ phần cuối cùng mới đáng để gọi mô hình.",
  "aiSupporter.allScopes": "Tất cả phạm vi",
  "aiSupporter.inScope": "Trong phạm vi",
  "aiSupporter.eligible": "Đủ điều kiện",
  "aiSupporter.eligibleHint": "trong phạm vi · gửi báo cáo · nhận thưởng",
  "aiSupporter.highSeverity": "Cao / Nghiêm trọng",
  "aiSupporter.evaluated": "Đã đánh giá",
  "aiSupporter.recommended": "Được đề xuất",
  "aiSupporter.recommendedHint": "điểm từ 70",
  "aiSupporter.candidatePool": "Chờ đánh giá",
  "aiSupporter.sourceModel": "Đề xuất được hỗ trợ bởi {model}.",
  "aiSupporter.sourceHeuristic":
    "Chưa cấu hình mô hình AI — đề xuất dùng bộ quy tắc ngoại tuyến và được gắn nhãn QUY TẮC, không phải AI. Hãy cấu hình mô hình trong Cài đặt → AI.",
  "aiSupporter.recommendations": "Đề xuất",
  "aiSupporter.focus": "Trọng tâm",
  "aiSupporter.focusAll": "Tất cả phạm vi đủ điều kiện",
  "aiSupporter.focusHighValue": "Loại tài sản giá trị cao",
  "aiSupporter.batchSize": "Kích thước lô",
  "aiSupporter.generate": "Tạo đề xuất",
  "aiSupporter.generating": "Đang đánh giá…",
  "aiSupporter.generated": "Đã đánh giá {evaluated} phạm vi; {failed} thất bại.",
  "aiSupporter.generateHelp":
    "Ưu tiên đánh giá phạm vi đủ điều kiện có giá trị cao nhất chưa được đánh giá. Giới hạn mỗi lần chạy để kiểm soát chi phí.",
  "aiSupporter.empty": "Chưa có đề xuất nào",
  "aiSupporter.emptyHelp":
    "Phạm vi đủ điều kiện của bạn chưa được đánh giá. Hãy tạo một lô để xếp hạng các tài sản giá trị cao nhất.",
  "aiSupporter.open": "Mở",
  "aiSupporter.viewInAssets": "Xem tất cả trong Tài sản",
};
