package {{PACKAGE_NAME}}

import future.keywords

default allow := false

is_success := data.data.success

allow if {
    is_success
}
